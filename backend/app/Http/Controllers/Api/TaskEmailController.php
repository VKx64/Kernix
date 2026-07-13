<?php

namespace App\Http\Controllers\Api;

use App\Models\SystemSetting;
use App\Models\Task;
use App\Models\TaskEmail;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;

class TaskEmailController extends ApiController
{
    public function index(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.email');
        $this->withinClient($task);

        $emails = $task->emails()->with(['sender', 'attachments'])->latest()->get()
            ->map(fn (TaskEmail $email) => $this->present($email));

        return $this->data($emails);
    }

    public function store(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.email');
        TaskMutationGuard::enforce($request);
        $this->withinClient($task);
        $data = $request->validate([
            'to_addresses' => ['required', fn ($attribute, $value, $fail) => (! is_string($value) && ! is_array($value)) ? $fail('Recipients must be an email list.') : null],
            'cc_addresses' => ['sometimes', 'nullable', fn ($attribute, $value, $fail) => (! is_string($value) && ! is_array($value)) ? $fail('CC recipients must be an email list.') : null],
            'bcc_addresses' => ['sometimes', 'nullable', fn ($attribute, $value, $fail) => (! is_string($value) && ! is_array($value)) ? $fail('BCC recipients must be an email list.') : null],
            'subject' => ['required', 'string', 'max:500'], 'body' => ['required', 'string', 'max:200000'],
        ]);
        $to = $this->emails($data['to_addresses'], 'to_addresses');
        $cc = $this->emails($data['cc_addresses'] ?? [], 'cc_addresses');
        $bcc = $this->emails($data['bcc_addresses'] ?? [], 'bcc_addresses');
        $email = $task->emails()->create([
            'sent_by' => $request->user()->id,
            'to_addresses' => implode(', ', $to), 'cc_addresses' => $cc ? implode(', ', $cc) : null,
            'bcc_addresses' => $bcc ? implode(', ', $bcc) : null,
            'subject' => $data['subject'], 'body' => $data['body'], 'status' => 'queued',
        ]);

        try {
            $usesDeliveryTransport = $this->configureMailer();
            Mail::raw($email->body, function ($message) use ($to, $cc, $bcc, $email) {
                $message->to($to)->subject($email->subject);
                if ($cc) {
                    $message->cc($cc);
                }
                if ($bcc) {
                    $message->bcc($bcc);
                }
            });
            $email->update([
                'status' => $usesDeliveryTransport ? 'sent' : 'logged',
                'sent_at' => $usesDeliveryTransport ? now() : null,
                'error_message' => null,
            ]);
        } catch (\Throwable $exception) {
            report($exception);
            $email->update(['status' => 'failed', 'error_message' => mb_substr($exception->getMessage(), 0, 5000)]);
        }
        $this->audit($request, 'task.email.send', $task, ['email_id' => $email->id, 'status' => $email->status]);

        return $this->data($this->present($email->fresh()), 201);
    }

    public function show(Request $request, Task $task, TaskEmail $email): JsonResponse
    {
        $this->permission($request, 'tasks.email');
        $this->assertNested($task, $email);
        $this->withinClient($task);

        return $this->data($this->present($email));
    }

    public function destroy(Request $request, Task $task, TaskEmail $email): JsonResponse
    {
        $this->permission($request, 'tasks.email');
        TaskMutationGuard::enforce($request);
        $this->assertNested($task, $email);
        $this->withinClient($task);
        $email->delete();
        $this->audit($request, 'task.email.delete', $task, ['email_id' => $email->id]);

        return response()->json(null, 204);
    }

    private function emails(mixed $value, string $key): array
    {
        $items = is_array($value) ? $value : preg_split('/[,;]+/', (string) $value);
        $items = array_values(array_filter(array_map('trim', $items ?: [])));
        Validator::make([$key => $items], [
            $key => $key === 'to_addresses' ? ['required', 'array', 'min:1'] : ['array'],
            $key.'.*' => ['email:rfc'],
        ])->validate();

        return $items;
    }

    private function configureMailer(): bool
    {
        $settings = SystemSetting::find(1);
        if (! $settings?->smtp_host) {
            return ! in_array(config('mail.default'), ['array', 'log'], true);
        }
        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp.host' => $settings->smtp_host,
            'mail.mailers.smtp.port' => $settings->smtp_port,
            'mail.mailers.smtp.scheme' => $settings->smtp_encryption === 'ssl' ? 'smtps' : null,
            'mail.mailers.smtp.username' => $settings->smtp_username,
            'mail.mailers.smtp.password' => $settings->smtp_password,
            'mail.from.address' => $settings->smtp_from_email ?: config('mail.from.address'),
            'mail.from.name' => $settings->smtp_from_name ?: config('mail.from.name'),
        ]);
        Mail::purge('smtp');

        return true;
    }

    private function assertNested(Task $task, TaskEmail $email): void
    {
        abort_unless((int) $email->task_id === (int) $task->id, 404);
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }

    private function present(TaskEmail $email): TaskEmail
    {
        $email->load(['sender', 'attachments']);
        $sender = $this->summaryRelation($this->userSummary($email->sender));
        $email->setRelation('sender', $sender);
        $email->setRelation('author', $sender);

        return $email;
    }
}
