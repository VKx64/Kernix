<?php

namespace App\Services;

use App\Models\FormSubmission;
use App\Models\FormSubmissionFile;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

/**
 * Storage for files an anonymous visitor attaches to a public form
 * submission. Deliberately NOT TaskAttachmentStorage: that class blocks by
 * `getClientOriginalExtension()` and stores `getClientMimeType()`, both of
 * which the uploading client fully controls. Fine for a signed-in staff
 * member; not fine for a stranger on the internet. Everything here is keyed
 * off `getMimeType()` — Symfony's finfo-backed, content-derived guess —
 * never the filename or the client-declared Content-Type.
 */
class FormSubmissionFileStorage
{
    public const DISK = 'local';

    public const MAX_FILES = 3;

    public const MAX_FILE_BYTES = 10_485_760; // 10 MB

    /**
     * Aggregate ceilings across an ENTIRE submission, not one field. Per-file
     * caps (MAX_FILES / MAX_FILE_BYTES above) apply per field, and a form can
     * define up to FormFieldCatalogue::MAX_FIELDS file fields — these two
     * stop that fan-out from turning one anonymous POST into tens of files
     * or hundreds of megabytes on disk. Enforced in
     * PublicFormController::store() before a single byte is written.
     */
    public const MAX_TOTAL_FILES = 10;

    public const MAX_TOTAL_BYTES = 31_457_280; // 30 MiB

    /** @var array<int, string> */
    public const ACCEPTED_MIMES = ['image/png', 'image/jpeg', 'video/mp4', 'application/pdf'];

    /** Extension is derived from the verified mime, never the client's filename. */
    private const EXTENSIONS = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'video/mp4' => 'mp4',
        'application/pdf' => 'pdf',
    ];

    /**
     * @param  array<string, array<int, UploadedFile>>  $filesByField  uploads keyed by the form field id
     *                                                                 they were posted under, e.g. ['fl3' => [UploadedFile, ...]]
     * @param  array<int, string>  $writtenPaths  filled with every path actually written to disk, in
     *                                            order, so a caller can delete them all if anything later in the same
     *                                            request throws — including a file later in this same batch.
     * @return array<int, FormSubmissionFile>
     */
    public function store(FormSubmission $submission, array $filesByField, array &$writtenPaths = []): array
    {
        $stored = [];
        foreach ($filesByField as $fieldId => $files) {
            foreach ($files as $file) {
                $mime = (string) $file->getMimeType();
                $extension = self::EXTENSIONS[$mime] ?? null;
                abort_if($extension === null, 422, 'That file type is not accepted.');

                $name = Str::ulid()->toBase32().'.'.$extension;
                $path = $file->storeAs("form-submissions/{$submission->id}", $name, self::DISK);
                // The 'local' disk has 'throw' => false (config/filesystems.php),
                // so a full disk or permissions failure returns false here
                // instead of throwing. Scoped to this one write path rather
                // than flipping that disk-wide setting: fail loudly so the
                // caller's transaction rolls back and nothing commits a
                // FormSubmissionFile row pointing at a path that was never
                // written.
                abort_if($path === false, 500, 'That file could not be stored. Please try again.');
                $writtenPaths[] = $path;

                $stored[] = FormSubmissionFile::query()->create([
                    'form_submission_id' => $submission->id,
                    'field_id' => is_string($fieldId) ? $fieldId : null,
                    'original_name' => $this->cleanName($file->getClientOriginalName()),
                    'file_name' => $name,
                    'storage_path' => $path,
                    'mime_type' => $mime,
                    'file_size' => $file->getSize() ?: 0,
                    'storage_driver' => self::DISK,
                ]);
            }
        }

        return $stored;
    }

    /**
     * Kept for display only. Truncated to the column width and stripped of
     * control characters — a newline in here is a Content-Disposition
     * header-injection attempt, not a real filename.
     */
    private function cleanName(?string $name): string
    {
        $stripped = preg_replace('/[\x00-\x1F\x7F]/', '', (string) $name) ?? '';
        $stripped = trim($stripped);

        return mb_substr($stripped !== '' ? $stripped : 'file', 0, 255);
    }
}
