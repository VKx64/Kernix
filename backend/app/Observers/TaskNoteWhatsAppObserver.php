<?php

namespace App\Observers;

use App\Models\TaskNote;
use App\Services\WhatsAppNotifier;
use Throwable;

/**
 * One hook covers most of what a person would want on their phone.
 *
 * Work requests, estimate decisions, completion audits, and plain messages all
 * reach their recipient the same way in Kernix: a note with `is_message` and an
 * `assigned_user_id`. Watching that instead of each workflow means a new
 * workflow that delivers through a message is on WhatsApp the day it ships,
 * without another hook.
 *
 * Delivery failures are swallowed on purpose. The note is the record and it is
 * already saved; a WhatsApp bridge that is reconnecting must not roll back
 * somebody's message or fail their request.
 */
class TaskNoteWhatsAppObserver
{
    public function __construct(private readonly WhatsAppNotifier $notifier) {}

    public function created(TaskNote $note): void
    {
        if (! $note->is_message || ! $note->assigned_user_id) {
            return;
        }

        try {
            $this->notifier->taskMessage($note);
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
