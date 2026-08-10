<?php

namespace App\Http\Controllers\Api;

use App\Models\FormSubmission;
use App\Models\FormSubmissionFile;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FormSubmissionFileController extends ApiController
{
    /**
     * The only way a form-submission file is ever served back: authenticated,
     * addressed by id, never by the storage path an anonymous upload used.
     * Mirrors TaskAttachmentController::show's headers exactly — the sandbox
     * CSP is what makes an inline PDF or image safe to view.
     */
    public function show(Request $request, FormSubmission $submission, FormSubmissionFile $file): BinaryFileResponse|StreamedResponse
    {
        $this->permission($request, 'forms.view');
        $this->assertNested($submission, $file);

        $disk = Storage::disk($file->storage_driver ?: 'local');
        abort_unless($disk->exists($file->storage_path), 404, 'This file is no longer stored on the server.');

        $mime = $file->mimeType();
        $inline = $request->boolean('inline') && $file->canPreview();
        $headers = [
            'Content-Type' => $mime,
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ];

        $absolute = $disk->path($file->storage_path);
        if (is_file($absolute)) {
            return response()->file($absolute, $headers)->setContentDisposition(
                $inline ? ResponseHeaderBag::DISPOSITION_INLINE : ResponseHeaderBag::DISPOSITION_ATTACHMENT,
                $file->original_name,
            );
        }

        return $disk->download($file->storage_path, $file->original_name, $headers);
    }

    private function assertNested(FormSubmission $submission, FormSubmissionFile $file): void
    {
        abort_unless((int) $file->form_submission_id === (int) $submission->id, 404);
    }
}
