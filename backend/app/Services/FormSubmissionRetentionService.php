<?php

namespace App\Services;

use App\Models\FormSubmission;
use App\Models\FormSubmissionFile;
use Illuminate\Support\Facades\Storage;

/**
 * Prunes anonymous form-submission data nobody needs anymore. A submission
 * only qualifies once it has left the review queue (status converted or
 * declined) AND has sat decided for RETENTION_DAYS — a `status = 'new'`
 * submission is someone's open work item and is never touched here,
 * regardless of age.
 *
 * Disk objects are removed before the rows that reference them, per
 * submission, so an interruption partway through never leaves a live row
 * pointing at bytes that no longer exist as "clean" — worst case is a
 * dangling row whose file is already gone, which the next run finishes by
 * hard-deleting a row for a path that Storage::delete() just no-ops on.
 * That's also why this is safe to run twice: every step here is idempotent.
 */
class FormSubmissionRetentionService
{
    /**
     * How long a decided (converted/declined) submission's PII and files are
     * kept before this prune removes them. A `new` submission is exempt no
     * matter how old — see class docblock.
     */
    public const RETENTION_DAYS = 180;

    /** @return array{submissions: int, files: int, bytes: int} */
    public function prune(): array
    {
        $cutoff = now()->subDays(self::RETENTION_DAYS);
        $submissions = 0;
        $files = 0;
        $bytes = 0;

        FormSubmission::acrossWorkspaces()
            ->whereIn('status', ['converted', 'declined'])
            ->where('decided_at', '<=', $cutoff)
            ->orderBy('id')
            ->eachById(function (FormSubmission $submission) use (&$submissions, &$files, &$bytes): void {
                [$fileCount, $fileBytes] = $this->pruneOne($submission);
                $submissions++;
                $files += $fileCount;
                $bytes += $fileBytes;
            });

        return ['submissions' => $submissions, 'files' => $files, 'bytes' => $bytes];
    }

    /** @return array{0: int, 1: int} [files deleted, bytes reclaimed] */
    private function pruneOne(FormSubmission $submission): array
    {
        // withTrashed(): a file row already soft-deleted by other means never
        // had its bytes reclaimed either — this is the one place that does,
        // so it must not skip soft-deleted rows.
        $fileRows = FormSubmissionFile::withTrashed()
            ->where('form_submission_id', $submission->id)
            ->get();

        $count = 0;
        $bytes = 0;

        foreach ($fileRows as $file) {
            $disk = Storage::disk($file->storage_driver ?: FormSubmissionFileStorage::DISK);
            $disk->delete($file->storage_path);
            $file->forceDelete();
            $count++;
            $bytes += (int) $file->file_size;
        }

        Storage::disk(FormSubmissionFileStorage::DISK)->deleteDirectory("form-submissions/{$submission->id}");

        $submission->delete();

        return [$count, $bytes];
    }
}
