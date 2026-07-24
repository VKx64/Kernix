<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskEstimateRequest;
use App\Models\TaskNote;
use App\Models\User;

class TaskMessageService
{
    public function start(Task $task, User $author, int $recipientId, string $body, ?TaskEstimateRequest $estimateRequest = null): TaskNote
    {
        $note = $task->notes()->create([
            'body' => $body,
            'assigned_user_id' => $recipientId,
            'created_by' => $author->id,
            'is_message' => true,
            'estimate_request_id' => $estimateRequest?->id,
        ]);
        $note->update(['conversation_id' => $note->id]);

        return $note;
    }

    public function reply(TaskNote $root, User $author, int $recipientId, string $body): TaskNote
    {
        return $root->task->notes()->create([
            'body' => $body,
            'assigned_user_id' => $recipientId,
            'created_by' => $author->id,
            'is_message' => true,
            'conversation_id' => $root->id,
            'estimate_request_id' => $root->estimate_request_id,
        ]);
    }

    public function replyAsActor(TaskNote $root, string $actorType, int $recipientId, string $body, ?int $aiReviewRunId = null): TaskNote
    {
        return $root->task->notes()->create([
            'body' => $body,
            'assigned_user_id' => $recipientId,
            'created_by' => null,
            'actor_type' => $actorType,
            'is_message' => true,
            'conversation_id' => $root->id,
            'estimate_request_id' => $root->estimate_request_id,
            'ai_review_run_id' => $aiReviewRunId,
        ]);
    }
}
