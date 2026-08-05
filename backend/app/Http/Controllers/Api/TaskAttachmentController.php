<?php

namespace App\Http\Controllers\Api;

use App\Models\Task;
use App\Models\TaskAttachment;
use App\Services\TaskAttachmentStorage;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TaskAttachmentController extends ApiController
{
    public function __construct(private readonly TaskAttachmentStorage $storage) {}

    public function index(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($task);

        return $this->data($this->collection($task));
    }

    public function store(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.attachments');
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);

        $request->validate([
            'files' => ['required', 'array', 'min:1', 'max:'.TaskAttachmentStorage::MAX_FILES_PER_REQUEST],
            'files.*' => ['required', 'file', 'max:'.TaskAttachmentStorage::MAX_FILE_KB],
        ], [
            'files.*.max' => 'Each file must be '.(int) (TaskAttachmentStorage::MAX_FILE_KB / 1024).' MB or smaller.',
        ]);

        $stored = $this->storage->store($task, array_values($request->file('files')), $request->user());
        foreach ($stored as $attachment) {
            $this->audit($request, 'task.attachment.create', $task, [
                'attachment_id' => $attachment->id,
                'original_name' => $attachment->original_name,
                'file_size' => $attachment->file_size,
            ]);
        }

        return $this->data(array_map(fn (TaskAttachment $attachment) => $this->present($attachment), $stored), 201);
    }

    public function show(Request $request, Task $task, TaskAttachment $attachment): BinaryFileResponse|StreamedResponse
    {
        $this->permission($request, 'tasks.view');
        $this->assertNested($task, $attachment);
        $this->withinClient($task);

        $disk = Storage::disk($attachment->storage_driver ?: TaskAttachmentStorage::DISK);
        abort_unless($disk->exists($attachment->storage_path), 404, 'This file is no longer stored on the server.');

        $mime = $attachment->mimeType();
        $inline = $request->boolean('inline') && $attachment->canPreview();
        $headers = [
            'Content-Type' => $mime,
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ];

        // A real path lets Symfony answer Range requests, so a video can seek.
        $absolute = $disk->path($attachment->storage_path);
        if (is_file($absolute)) {
            return response()->file($absolute, $headers)->setContentDisposition(
                $inline ? ResponseHeaderBag::DISPOSITION_INLINE : ResponseHeaderBag::DISPOSITION_ATTACHMENT,
                $attachment->original_name,
            );
        }

        return $disk->download($attachment->storage_path, $attachment->original_name, $headers);
    }

    public function destroy(Request $request, Task $task, TaskAttachment $attachment): JsonResponse
    {
        $this->permission($request, 'tasks.attachments');
        $this->assertNested($task, $attachment);
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);

        // The row is kept for the audit trail; the bytes are not.
        Storage::disk($attachment->storage_driver ?: TaskAttachmentStorage::DISK)->delete($attachment->storage_path);
        $attachment->delete();
        $this->audit($request, 'task.attachment.delete', $task, [
            'attachment_id' => $attachment->id,
            'original_name' => $attachment->original_name,
        ]);

        return response()->json(null, 204);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function collection(Task $task): array
    {
        return $task->attachments()->with('uploader')->orderByDesc('id')->get()
            ->map(fn (TaskAttachment $attachment) => $this->present($attachment))
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function present(TaskAttachment $attachment): array
    {
        $uploader = $attachment->relationLoaded('uploader') ? $attachment->uploader : $attachment->uploader()->first();

        return $attachment->toSummary($this->userSummary($uploader));
    }

    private function assertNested(Task $task, TaskAttachment $attachment): void
    {
        abort_unless((int) $attachment->task_id === (int) $task->id, 404);
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }
}
