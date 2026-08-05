<?php

namespace App\Http\Controllers\Api;

use App\Models\Task;
use App\Models\TaskNote;
use App\Models\User;
use App\Services\AiEstimateReviewCoordinator;
use App\Services\TaskMessageService;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageController extends ApiController
{
    public function __construct(
        private readonly TaskMessageService $messages,
        private readonly AiEstimateReviewCoordinator $aiReviews,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $query = $this->ownedConversations($request)->with($this->relations());
        if ($request->string('filter', 'unread')->toString() !== 'all') {
            $query->whereHas('replies', fn (Builder $messages) => $messages
                ->where('assigned_user_id', $request->user()->id)
                ->whereNull('read_at'));
        }
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn (Builder $builder) => $builder
                ->whereHas('replies', fn (Builder $messages) => $messages->where('body', 'like', "%{$search}%"))
                ->orWhereHas('task', fn (Builder $task) => $task->where('title', 'like', "%{$search}%"))
                ->orWhereHas('replies.author', fn (Builder $author) => $author->where(
                    fn (Builder $name) => $name->where('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")
                )));
        }
        $page = $query->orderByDesc(
            TaskNote::query()
                ->from('task_notes as conversation_messages')
                ->select('conversation_messages.created_at')
                ->whereColumn('conversation_messages.conversation_id', 'task_notes.id')
                ->latest('conversation_messages.created_at')
                ->limit(1)
        )->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (TaskNote $root) => $this->presentConversation($root, $request));

        return $this->paginated($page);
    }

    public function show(Request $request, int $message): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $root = $this->ownedConversations($request)->with($this->relations())->findOrFail($message);

        return $this->data($this->presentConversation($root, $request));
    }

    /**
     * Opening a conversation with someone. Every conversation still hangs off a
     * task — that is the shared context both people need — but the sender picks
     * the task and the person instead of waiting for a task to reach them.
     */
    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $this->permission($request, 'tasks.comment');
        $data = $request->validate([
            'task_id' => ['required', 'integer'],
            'recipient_id' => ['required', 'integer'],
            'body' => ['required', 'string', 'max:100000'],
        ]);
        $task = Task::query()
            ->when(SingleClient::enabled(), fn (Builder $query) => $query->whereHas('project', fn (Builder $project) => $project->where('client_id', SingleClient::id() ?? 0)))
            ->findOrFail($data['task_id']);
        TaskMutationGuard::enforce($request, $task);
        abort_if((int) $data['recipient_id'] === (int) $request->user()->id, 422, 'Pick somebody other than yourself.');
        abort_unless($this->recipientQuery($request)->whereKey($data['recipient_id'])->exists(), 422, 'That person cannot receive messages.');
        $root = $this->messages->start($task, $request->user(), (int) $data['recipient_id'], trim($data['body']));
        $this->audit($request, 'task.message.start', $task, [
            'conversation_id' => $root->id,
            'recipient_id' => (int) $data['recipient_id'],
        ]);

        return $this->data($this->presentConversation($root->fresh($this->relations()), $request), 201);
    }

    /** People the signed-in user is allowed to open a conversation with. */
    public function recipients(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $query = $this->recipientQuery($request);
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn (Builder $name) => $name
                ->where('first_name', 'like', "%{$search}%")
                ->orWhere('last_name', 'like', "%{$search}%")
                ->orWhere('username', 'like', "%{$search}%"));
        }

        return $this->data($query->orderBy('first_name')->orderBy('last_name')->limit(100)->get()
            ->map(fn (User $user) => $this->userSummary($user))->all());
    }

    public function reply(Request $request, int $message): JsonResponse
    {
        $this->permission($request, 'tasks.comment');
        $root = $this->ownedConversations($request)->with(['task.project', 'estimateRequest'])->findOrFail($message);
        TaskMutationGuard::enforce($request, $root->task);
        $data = $request->validate(['body' => ['required', 'string', 'max:100000']]);
        $recipientId = $this->replyRecipient($request, $root);
        $reply = $this->messages->reply($root, $request->user(), $recipientId, trim($data['body']));
        if (
            $root->estimateRequest
            && $root->estimateRequest->review_mode === 'ai'
            && $root->estimateRequest->status === 'pending'
            && (int) $root->estimateRequest->requested_by === (int) $request->user()->id
        ) {
            $this->aiReviews->queue($root->estimateRequest, $reply);
        }
        $this->audit($request, 'task.message.reply', $root->task, [
            'conversation_id' => $root->id,
            'message_id' => $reply->id,
        ]);

        return $this->data($this->presentMessage($reply->fresh(['author', 'assignedUser', 'attachments'])), 201);
    }

    public function read(Request $request, int $message): JsonResponse
    {
        return $this->setRead($request, $message, true);
    }

    public function unread(Request $request, int $message): JsonResponse
    {
        return $this->setRead($request, $message, false);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $count = TaskNote::query()
            ->where('is_message', true)
            ->where('assigned_user_id', $request->user()->id)
            ->whereNull('read_at')
            ->when(SingleClient::enabled(), fn (Builder $query) => $query->whereHas('task.project', fn (Builder $project) => $project->where('client_id', SingleClient::id() ?? 0)))
            ->update(['read_at' => now(), 'read_by_user_id' => $request->user()->id, 'updated_at' => now()]);

        return $this->data(['updated' => $count]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $count = $this->ownedConversations($request)
            ->whereHas('replies', fn (Builder $messages) => $messages
                ->where('assigned_user_id', $request->user()->id)
                ->whereNull('read_at'))
            ->count();

        return $this->data(['count' => $count, 'unread_count' => $count]);
    }

    private function setRead(Request $request, int $message, bool $read): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $root = $this->ownedConversations($request)->with($this->relations())->findOrFail($message);
        $incoming = $root->replies()->where('assigned_user_id', $request->user()->id);
        if ($read) {
            $incoming->whereNull('read_at')->update(['read_at' => now(), 'read_by_user_id' => $request->user()->id]);
        } else {
            $latest = $incoming->latest()->first();
            $latest?->update(['read_at' => null, 'read_by_user_id' => null]);
        }

        return $this->data($this->presentConversation($root->fresh($this->relations()), $request));
    }

    private function ownedConversations(Request $request): Builder
    {
        $query = TaskNote::query()
            ->where('is_message', true)
            ->whereColumn('task_notes.id', 'task_notes.conversation_id')
            ->where(function (Builder $conversations) use ($request): void {
                $conversations->whereHas('replies', fn (Builder $messages) => $messages->where(
                    fn (Builder $participant) => $participant
                        ->where('created_by', $request->user()->id)
                        ->orWhere('assigned_user_id', $request->user()->id)
                ));
                if ($request->user()->isAdmin()) {
                    $conversations->orWhereNotNull('estimate_request_id');
                } elseif ($request->user()->canDo('tasks.review_estimate_requests')) {
                    $conversations->orWhere(fn (Builder $estimate) => $estimate
                        ->whereNotNull('estimate_request_id')
                        ->whereHas('task.project', fn (Builder $project) => $project->where('manager_user_id', $request->user()->id)));
                }
            });
        if (SingleClient::enabled()) {
            $query->whereHas('task.project', fn (Builder $project) => $project->where('client_id', SingleClient::id() ?? 0));
        }

        return $query;
    }

    /**
     * The messages surface shows task context beside the thread — status, due
     * date, and time — so it needs more than the shared four-field summary.
     *
     * @return array<string, mixed>|null
     */
    private function conversationTaskSummary(?Task $task): ?array
    {
        if (! $task) {
            return null;
        }

        return $this->taskSummary($task) + [
            'due_date' => $task->due_date?->toDateString(),
            'estimated_minutes' => $task->estimated_minutes,
            'actual_minutes' => $task->actual_minutes,
            'assignee_user_id' => $task->assignee_user_id,
            'assignee' => $this->userSummary($task->assignee),
            'status_value' => $task->status ? [
                'id' => $task->status->id,
                'label' => $task->status->label,
                'key_name' => $task->status->key_name,
                'color' => $task->status->color,
            ] : null,
        ];
    }

    private function recipientQuery(Request $request): Builder
    {
        return User::query()
            ->whereKeyNot($request->user()->id)
            ->where('status', 'active')
            ->whereNull('archived_at');
    }

    private function replyRecipient(Request $request, TaskNote $root): int
    {
        if ($root->estimateRequest) {
            $estimateRequest = $root->estimateRequest;
            if ((int) $estimateRequest->requested_by === (int) $request->user()->id) {
                $managerId = $root->task->project?->manager_user_id;
                abort_unless($managerId, 409, 'This project does not currently have a manager.');

                return (int) $managerId;
            }
            if (! $request->user()->isAdmin()) {
                $this->permission($request, 'tasks.review_estimate_requests');
                abort_unless((int) $root->task->project?->manager_user_id === (int) $request->user()->id, 403);
            }

            return (int) $estimateRequest->requested_by;
        }

        if ((int) $root->created_by === (int) $request->user()->id) {
            return (int) $root->assigned_user_id;
        }
        abort_unless((int) $root->assigned_user_id === (int) $request->user()->id, 403);

        return (int) $root->created_by;
    }

    /** @return array<int|string, mixed> */
    private function relations(): array
    {
        return [
            'task.project.client', 'task.status', 'task.assignee',
            'estimateRequest.requester', 'estimateRequest.reviewer', 'estimateRequest.decider',
            'estimateRequest.latestAiReviewRun', 'estimateRequest.decisions.decider',
            'replies' => fn ($query) => $query->with(['author', 'assignedUser', 'attachments'])->oldest(),
        ];
    }

    private function presentConversation(TaskNote $root, Request $request): TaskNote
    {
        $root->setAttribute('subject', $root->estimateRequest ? 'Estimate increase · '.($root->task?->title ?? 'Task') : ($root->task?->title ?? 'Task message'));
        $messages = $root->replies->map(fn (TaskNote $message) => $this->presentMessage($message));
        $root->setRelation('messages', $messages);
        $root->setAttribute('latest_message', $messages->last());
        $root->setAttribute('unread_count', $messages->filter(fn (TaskNote $message) => (int) $message->assigned_user_id === (int) $request->user()->id && ! $message->read_at)->count());
        $root->setRelation('task', $this->summaryRelation($this->conversationTaskSummary($root->task)));
        if ($root->estimateRequest) {
            $estimateRequest = $root->estimateRequest;
            $estimateRequest->setRelation('requester', $this->summaryRelation($this->userSummary($estimateRequest->requester)));
            $estimateRequest->setRelation('reviewer', $this->summaryRelation($this->userSummary($estimateRequest->reviewer)));
            $estimateRequest->setRelation('decider', $this->summaryRelation($this->userSummary($estimateRequest->decider)));
            $estimateRequest->decisions->each(fn ($decision) => $decision->setRelation(
                'decider', $this->summaryRelation($this->userSummary($decision->decider))
            ));
            $root->setAttribute('can_review', $request->user()->isAdmin() || (
                $request->user()->canDo('tasks.review_estimate_requests')
                && (int) $root->task?->project?->manager_user_id === (int) $request->user()->id
            ));
            $root->setAttribute('can_override', $estimateRequest->review_mode === 'ai'
                && in_array($estimateRequest->status, ['approved', 'rejected'], true)
                && $estimateRequest->decision_source === 'ai'
                && ($request->user()->isAdmin() || (
                    $request->user()->canDo('tasks.review_estimate_requests')
                    && (int) $root->task?->project?->manager_user_id === (int) $request->user()->id
                )));
        }

        return $root;
    }

    private function presentMessage(TaskNote $message): TaskNote
    {
        $message->setRelation('author', $this->summaryRelation($this->userSummary($message->author)));
        $message->setRelation('assignedUser', $this->summaryRelation($this->userSummary($message->assignedUser)));
        if ($message->actor_type === 'ai') {
            $message->setAttribute('actor_name', 'AI Project Manager');
        } elseif ($message->actor_type === 'system') {
            $message->setAttribute('actor_name', 'System');
        }

        return $message;
    }
}
