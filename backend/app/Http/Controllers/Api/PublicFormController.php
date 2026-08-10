<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FormSubmission;
use App\Models\ProjectForm;
use App\Services\FormSubmissionConverter;
use App\Services\FormSubmissionFileStorage;
use App\Support\FormFieldCatalogue;
use App\Support\PublicFormAvailability;
use App\Support\SubmissionDuplicates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * The public, unauthenticated half of Project Forms. Reached only through
 * routes/public.php + ResolvePublicForm, which resolves {slug} to a form and
 * runs this controller inside that form's workspace — see the hazard
 * documented on both. Every response here is built as a plain array before
 * it is returned; nothing lazy-loaded from an Eloquent relation is ever
 * handed to the response layer, because serialisation can happen after the
 * workspace-scoping middleware has already unwound.
 */
class PublicFormController extends Controller
{
    /** @var array<string, string> */
    private const HEADERS = [
        'Cache-Control' => 'no-store, private',
        'Pragma' => 'no-cache',
        'X-Robots-Tag' => 'noindex, nofollow',
        'Referrer-Policy' => 'no-referrer',
    ];

    private const DAILY_FORM_CAP = 200;

    private const DAILY_EMAIL_CAP = 10;

    public function __construct(
        private readonly FormSubmissionFileStorage $fileStorage,
        private readonly FormSubmissionConverter $converter,
    ) {}

    public function show(Request $request): JsonResponse
    {
        [$form, $closedMessage] = $this->resolved($request);

        $payload = $closedMessage !== null
            ? $this->closedPayload($form, $closedMessage)
            : $this->openPayload($form);

        return $this->respond($payload, 200);
    }

    public function store(Request $request): JsonResponse
    {
        [$form, $closedMessage] = $this->resolved($request);
        if ($closedMessage !== null) {
            return $this->respond(['message' => $closedMessage], 422);
        }

        $fields = collect($form->fields ?? []);
        $fileFields = $fields->filter(fn (array $field): bool => ($field['type'] ?? null) === FormFieldCatalogue::FILE)
            ->keyBy(fn (array $field): string => (string) $field['id']);

        $files = $this->extractFiles($request, $fileFields);

        if ($files !== []) {
            // Aggregate ceiling across the WHOLE submission, checked before
            // any per-field rule runs and before a single byte is
            // persisted. Per-field caps below stop one field from being
            // abused; this stops a form with many `file` fields (up to
            // FormFieldCatalogue::MAX_FIELDS of them) from fanning that out
            // into far more files/bytes than the form's own advertised
            // per-field limits imply.
            $totalCount = 0;
            $totalBytes = 0;
            foreach ($files as $items) {
                $totalCount += count($items);
                foreach ($items as $item) {
                    if ($item instanceof UploadedFile) {
                        $totalBytes += (int) ($item->getSize() ?: 0);
                    }
                }
            }
            abort_if(
                $totalCount > FormSubmissionFileStorage::MAX_TOTAL_FILES || $totalBytes > FormSubmissionFileStorage::MAX_TOTAL_BYTES,
                422,
                PublicFormAvailability::MESSAGE,
            );

            $rules = [];
            foreach ($files as $fieldId => $items) {
                $cap = $this->fileCapFor($fileFields, $fieldId);
                // Cheap and first: an oversized array dies on its count
                // before a single per-file rule (mimetype, size) ever runs.
                abort_if(count($items) > $cap, 422, "No more than {$cap} files may be attached to that field.");

                $rules['files.'.$fieldId] = ['array', 'max:'.$cap];
                $rules['files.'.$fieldId.'.*'] = [
                    'file',
                    'max:'.intdiv(FormSubmissionFileStorage::MAX_FILE_BYTES, 1024),
                    'mimetypes:'.implode(',', FormSubmissionFileStorage::ACCEPTED_MIMES),
                    'mimes:png,jpg,jpeg,mp4,pdf',
                ];
            }
            $request->validate($rules);
        }

        $answers = $this->validateAnswers($fields, (array) $request->input('answers', []));

        $since = now()->subDay();
        $fromName = trim((string) $request->input('from_name', ''));
        $fromName = $fromName === '' ? null : mb_substr($fromName, 0, 120);
        $fromEmail = $this->resolveFromEmail($request, $form, $since);

        // The rolling per-form cap itself is enforced inside persist()'s
        // transaction, behind a locking read — see the comment there for
        // why a plain count-then-compare here would race under concurrent
        // submitters.
        [$submission, $writtenPaths] = $this->persist($form, $answers, $fromName, $fromEmail, $files, $request, $since);

        if ($form->auto_convert) {
            try {
                $this->converter->convert($submission->fresh(), null);
            } catch (Throwable $e) {
                // A server-side conversion failure must never lose the
                // submitter's data: the row already committed with
                // status "new" below, so it simply lands in the review
                // queue instead of auto-converting.
                report($e);
            }
        }

        return $this->respond([
            'reference' => $submission->reference,
            'submitted_at' => $submission->created_at->toIso8601String(),
            'email_on_file' => $fromEmail !== null,
        ], 201);
    }

    /** @return array{0: ProjectForm, 1: ?string} */
    private function resolved(Request $request): array
    {
        $form = $request->attributes->get('publicForm');
        $closedMessage = $request->attributes->get('publicFormClosedMessage');

        return [$form, $closedMessage];
    }

    /**
     * Uploads arrive keyed by the field id they were posted under —
     * `files[<fieldId>][]` — because a form can define more than one `file`
     * field and a flat, unkeyed `files[]` bucket has no way to say which
     * upload belongs to which. A key that is not one of this form's `file`
     * fields is rejected outright: it is either a stale client or a probe.
     *
     * @param  \Illuminate\Support\Collection<string, array<string, mixed>>  $fileFields  keyed by field id
     * @return array<string, array<int, UploadedFile>>
     */
    private function extractFiles(Request $request, $fileFields): array
    {
        $raw = $request->file('files');
        if ($raw === null) {
            return [];
        }
        abort_unless(is_array($raw), 422, 'Files must be posted per field, as files[<field id>][].');

        $byField = [];
        foreach ($raw as $fieldId => $items) {
            abort_unless(is_string($fieldId) && $fileFields->has($fieldId), 422, 'That field does not accept file uploads.');
            $byField[$fieldId] = array_values(is_array($items) ? $items : [$items]);
        }

        return $byField;
    }

    /** @param  \Illuminate\Support\Collection<string, array<string, mixed>>  $fileFields */
    private function fileCapFor($fileFields, string $fieldId): int
    {
        $configured = $fileFields->get($fieldId)['max'] ?? null;
        $cap = is_int($configured) && $configured > 0 ? $configured : FormSubmissionFileStorage::MAX_FILES;

        return min($cap, FormSubmissionFileStorage::MAX_FILES);
    }

    private function resolveFromEmail(Request $request, ProjectForm $form, \Illuminate\Support\Carbon $since): ?string
    {
        $raw = trim((string) $request->input('from_email', ''));

        if (! $form->require_email) {
            if ($raw === '' || ! filter_var($raw, FILTER_VALIDATE_EMAIL) || mb_strlen($raw) > FormFieldCatalogue::MAX_EMAIL) {
                return null;
            }

            $email = mb_strtolower($raw);
        } else {
            abort_if(
                $raw === '' || mb_strlen($raw) > FormFieldCatalogue::MAX_EMAIL || ! filter_var($raw, FILTER_VALIDATE_EMAIL),
                422,
                'A valid email address is required.',
            );
            $email = mb_strtolower($raw);
        }

        // Applies to ANY resolved email, not only when require_email is
        // true — an optional email field is still an email an anonymous
        // submitter controls, and skipping the cap for it would let the
        // same address submit without limit on a form that merely doesn't
        // require one.
        $emailCount = FormSubmission::query()
            ->where('project_form_id', $form->id)
            ->whereRaw('LOWER(from_email) = ?', [$email])
            ->where('created_at', '>=', $since)
            ->count();
        abort_if($emailCount >= self::DAILY_EMAIL_CAP, 422, PublicFormAvailability::MESSAGE);

        return $email;
    }

    /**
     * @param  array<string, array<int, UploadedFile>>  $files  keyed by field id
     * @return array{0: FormSubmission, 1: array<int, string>}
     */
    private function persist(ProjectForm $form, array $answers, ?string $fromName, ?string $fromEmail, array $files, Request $request, \Illuminate\Support\Carbon $since): array
    {
        $writtenPaths = [];
        $submission = null;

        try {
            DB::transaction(function () use (&$submission, $form, $answers, $fromName, $fromEmail, $files, $request, &$writtenPaths, $since) {
                // A rolling per-form cap a botnet cannot dodge by rotating
                // IPs — the only IP-independent bound on anonymous writes.
                // The locking read on the form row serializes every
                // concurrent submitter to this same form behind this one
                // transaction: the next one blocks here until this commits
                // or rolls back, then re-counts against fresh data, so two
                // concurrent requests can never both observe a count under
                // the cap and both commit.
                ProjectForm::query()->whereKey($form->id)->lockForUpdate()->firstOrFail();
                $recentCount = FormSubmission::query()
                    ->where('project_form_id', $form->id)
                    ->where('created_at', '>=', $since)
                    ->count();
                abort_if($recentCount >= self::DAILY_FORM_CAP, 422, PublicFormAvailability::MESSAGE);

                $submission = FormSubmission::query()->create([
                    'project_form_id' => $form->id,
                    'project_id' => $form->project_id,
                    'reference' => FormSubmission::generateReference(),
                    'from_name' => $fromName,
                    'from_email' => $fromEmail,
                    'answers' => $answers,
                    'form_snapshot' => $form->toSnapshot(),
                    'ip_hash' => hash_hmac('sha256', (string) $request->ip(), config('app.key')),
                    'user_agent' => mb_substr((string) $request->userAgent(), 0, 500),
                ]);

                if ($files !== []) {
                    $this->fileStorage->store($submission, $files, $writtenPaths);
                }

                $duplicate = SubmissionDuplicates::find($submission->fresh());
                if ($duplicate) {
                    $submission->update(['possible_duplicate_of' => $duplicate->id]);
                }
            });
        } catch (Throwable $e) {
            foreach ($writtenPaths as $path) {
                Storage::disk(FormSubmissionFileStorage::DISK)->delete($path);
            }
            throw $e;
        }

        return [$submission, $writtenPaths];
    }

    /**
     * @param  \Illuminate\Support\Collection<int, array<string, mixed>>  $fields
     * @param  array<string, mixed>  $rawAnswers
     * @return array<string, mixed>
     */
    private function validateAnswers($fields, array $rawAnswers): array
    {
        $answers = [];
        foreach ($fields as $field) {
            $id = $field['id'] ?? null;
            $type = $field['type'] ?? null;
            if (! is_string($id) || $id === '' || $type === FormFieldCatalogue::FILE) {
                continue;
            }

            $required = (bool) ($field['required'] ?? false);
            $label = (string) ($field['label'] ?? $id);
            $raw = $rawAnswers[$id] ?? null;
            $raw = is_string($raw) ? trim($raw) : $raw;

            if ($raw === null || $raw === '') {
                abort_if($required, 422, "\"{$label}\" is required.");

                continue;
            }

            $answers[$id] = match ($type) {
                FormFieldCatalogue::SHORT_TEXT => $this->boundedString($raw, FormFieldCatalogue::MAX_SHORT_TEXT, $label),
                FormFieldCatalogue::LONG_TEXT => $this->boundedString($raw, FormFieldCatalogue::MAX_LONG_TEXT, $label),
                FormFieldCatalogue::EMAIL => $this->fieldEmail($raw, $label),
                FormFieldCatalogue::DATE => $this->fieldDate($raw, $label),
                FormFieldCatalogue::STEPS => $this->fieldSteps($raw, $label),
                FormFieldCatalogue::SEVERITY, FormFieldCatalogue::SELECT => $this->fieldChoice($raw, $field, $label),
                default => abort(422, "Unknown field type for \"{$label}\"."),
            };
        }

        return $answers;
    }

    private function boundedString(mixed $raw, int $max, string $label): string
    {
        abort_unless(is_string($raw), 422, "\"{$label}\" must be text.");
        abort_if(mb_strlen($raw) > $max, 422, "\"{$label}\" is too long.");

        return $raw;
    }

    private function fieldEmail(mixed $raw, string $label): string
    {
        abort_unless(
            is_string($raw) && mb_strlen($raw) <= FormFieldCatalogue::MAX_EMAIL && filter_var($raw, FILTER_VALIDATE_EMAIL),
            422,
            "\"{$label}\" must be a valid email address.",
        );

        return mb_strtolower($raw);
    }

    private function fieldDate(mixed $raw, string $label): string
    {
        abort_unless(is_string($raw), 422, "\"{$label}\" must be a valid date.");
        $date = \DateTime::createFromFormat('Y-m-d', $raw);
        abort_unless($date && $date->format('Y-m-d') === $raw, 422, "\"{$label}\" must be a valid date.");

        return $raw;
    }

    private function fieldSteps(mixed $raw, string $label): string
    {
        abort_unless(is_string($raw), 422, "\"{$label}\" must be text.");
        $lines = preg_split('/\r\n|\r|\n/', $raw) ?: [];
        abort_if(count($lines) > FormFieldCatalogue::MAX_STEPS_LINES, 422, "\"{$label}\" is limited to ".FormFieldCatalogue::MAX_STEPS_LINES.' lines.');
        foreach ($lines as $line) {
            abort_if(mb_strlen($line) > FormFieldCatalogue::MAX_STEP_LINE, 422, "\"{$label}\" has a line that is too long.");
        }

        return $raw;
    }

    /** @param  array<string, mixed>  $field */
    private function fieldChoice(mixed $raw, array $field, string $label): string
    {
        abort_unless(is_string($raw), 422, "\"{$label}\" is not a valid choice.");
        $values = array_column($field['choices'] ?? [], 'value');
        abort_unless(in_array($raw, $values, true), 422, "\"{$label}\" is not a valid choice.");

        return $raw;
    }

    /** @return array<int, array<string, mixed>> */
    private function publicFields(array $fields): array
    {
        return array_map(function (array $field): array {
            $out = [
                'id' => $field['id'] ?? null,
                'type' => $field['type'] ?? null,
                'label' => $field['label'] ?? null,
                'help' => $field['help'] ?? null,
                'required' => (bool) ($field['required'] ?? false),
            ];
            if (! empty($field['choices'])) {
                $out['choices'] = array_map(fn (array $choice): array => [
                    'value' => $choice['value'] ?? null,
                    'label' => $choice['label'] ?? null,
                    'caption' => $choice['caption'] ?? null,
                ], $field['choices']);
            }
            if (($field['min'] ?? null) !== null) {
                $out['min'] = $field['min'];
            }
            if (($field['max'] ?? null) !== null) {
                $out['max'] = $field['max'];
            }

            return $out;
        }, $fields);
    }

    /**
     * `max_files` / `max_file_bytes` / `accepted_types` describe the ceiling
     * that applies to EACH `file` field on the form, not a total across the
     * whole submission — a form can define more than one `file` field, and
     * each is capped independently (see fileCapFor()). A field's own `max`,
     * when present in `fields[]` below, tightens that ceiling further for
     * that one field; it never raises it past what is declared here.
     *
     * `max_submission_files` / `max_submission_bytes` are the separate
     * aggregate ceiling across the WHOLE submission (see the check in
     * store()) — exposed so the public page can stop a submitter before
     * they upload past it, not just after the server rejects it.
     *
     * @return array<string, mixed>
     */
    private function openPayload(ProjectForm $form): array
    {
        return [
            'title' => $form->title,
            'blurb' => $form->blurb,
            'header_line' => $form->header_line,
            'closed' => false,
            'require_email' => (bool) $form->require_email,
            'max_files' => FormSubmissionFileStorage::MAX_FILES,
            'max_file_bytes' => FormSubmissionFileStorage::MAX_FILE_BYTES,
            'max_submission_files' => FormSubmissionFileStorage::MAX_TOTAL_FILES,
            'max_submission_bytes' => FormSubmissionFileStorage::MAX_TOTAL_BYTES,
            'accepted_types' => FormSubmissionFileStorage::ACCEPTED_MIMES,
            'fields' => $this->publicFields($form->fields ?? []),
        ];
    }

    /** @return array<string, mixed> */
    private function closedPayload(ProjectForm $form, string $message): array
    {
        return [
            'title' => $form->title,
            'blurb' => $form->blurb,
            'header_line' => $form->header_line,
            'closed' => true,
            'closed_message' => $message,
            'require_email' => (bool) $form->require_email,
            'max_files' => FormSubmissionFileStorage::MAX_FILES,
            'max_file_bytes' => FormSubmissionFileStorage::MAX_FILE_BYTES,
            'max_submission_files' => FormSubmissionFileStorage::MAX_TOTAL_FILES,
            'max_submission_bytes' => FormSubmissionFileStorage::MAX_TOTAL_BYTES,
            'accepted_types' => FormSubmissionFileStorage::ACCEPTED_MIMES,
            'fields' => [],
        ];
    }

    private function respond(array $payload, int $status): JsonResponse
    {
        return response()->json($payload, $status)->withHeaders(self::HEADERS);
    }
}
