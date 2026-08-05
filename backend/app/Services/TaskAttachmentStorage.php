<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskAttachment;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

class TaskAttachmentStorage
{
    /** Kilobytes; PHP's own upload_max_filesize/post_max_size still apply. */
    public const MAX_FILE_KB = 25600;

    public const MAX_FILES_PER_REQUEST = 10;

    public const DISK = 'local';

    public const BLOCKED_EXTENSIONS = [
        'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phtml', 'phar', 'htaccess', 'htpasswd',
        'exe', 'msi', 'com', 'bat', 'cmd', 'scr', 'cpl', 'jar', 'sh', 'bash', 'ps1', 'psm1', 'vbs', 'wsf',
    ];

    /**
     * @param  array<int, UploadedFile>  $files
     * @return array<int, TaskAttachment>
     */
    public function store(Task $task, array $files, User $actor, ?int $completionProofId = null): array
    {
        $stored = [];
        foreach ($files as $file) {
            $this->assertStorable($file);
        }
        foreach ($files as $file) {
            $name = Str::ulid()->toBase32().'.'.$this->extension($file);
            $path = $file->storeAs("task-attachments/{$task->id}", $name, self::DISK);
            $stored[] = TaskAttachment::query()->create([
                'task_id' => $task->id,
                'completion_proof_id' => $completionProofId,
                'original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
                'file_name' => $name,
                'storage_path' => $path,
                'mime_type' => $file->getClientMimeType(),
                'file_size' => $file->getSize() ?: 0,
                'storage_driver' => self::DISK,
                'uploaded_by' => $actor->id,
            ]);
        }

        return $stored;
    }

    public function assertStorable(UploadedFile $file): void
    {
        abort_if(
            in_array($this->extension($file), self::BLOCKED_EXTENSIONS, true),
            422,
            'Executable and script files cannot be attached to a task.',
        );
    }

    private function extension(UploadedFile $file): string
    {
        $extension = strtolower($file->getClientOriginalExtension() ?: (string) $file->guessExtension());

        return preg_replace('/[^a-z0-9]/', '', $extension) ?: 'bin';
    }
}
