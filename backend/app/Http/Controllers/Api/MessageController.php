<?php

namespace App\Http\Controllers\Api;

use App\Models\TaskNote;
use App\Support\SingleClient;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $query = $this->owned($request)->with(['task.project.client', 'author', 'attachments']);
        if ($request->string('filter', 'unread')->toString() !== 'all') {
            $query->whereNull('read_at');
        }
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn ($builder) => $builder
                ->where('body', 'like', "%{$search}%")
                ->orWhereHas('task', fn ($task) => $task->where('title', 'like', "%{$search}%"))
                ->orWhereHas('author', fn ($author) => $author->where(
                    fn ($name) => $name->where('first_name', 'like', "%{$search}%")->orWhere('last_name', 'like', "%{$search}%")
                )));
        }
        $page = $query->latest()->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (TaskNote $note) => $this->present($note));

        return $this->paginated($page);
    }

    public function show(Request $request, int $message): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $note = $this->owned($request)->with(['task.project.client', 'author', 'attachments'])->findOrFail($message);

        return $this->data($this->present($note));
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
        $count = $this->owned($request)->whereNull('read_at')->update([
            'read_at' => now(), 'read_by_user_id' => $request->user()->id, 'updated_at' => now(),
        ]);

        return $this->data(['updated' => $count]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $count = $this->owned($request)->whereNull('read_at')->count();

        return $this->data(['count' => $count, 'unread_count' => $count]);
    }

    private function setRead(Request $request, int $message, bool $read): JsonResponse
    {
        $this->permission($request, 'messages.view');
        $note = $this->owned($request)->findOrFail($message);
        $note->update([
            'read_at' => $read ? now() : null,
            'read_by_user_id' => $read ? $request->user()->id : null,
        ]);

        return $this->data($this->present($note->fresh(['task.project.client', 'author', 'attachments'])));
    }

    private function owned(Request $request): Builder
    {
        $query = TaskNote::query()
            ->where('is_message', true)
            ->where('assigned_user_id', $request->user()->id);
        if (SingleClient::enabled()) {
            $query->whereHas('task.project', fn ($project) => $project->where('client_id', SingleClient::id() ?? 0));
        }

        return $query;
    }

    private function present(TaskNote $note): TaskNote
    {
        $note->setAttribute('subject', $note->task?->title ?? 'Task message');
        $author = $this->summaryRelation($this->userSummary($note->author));
        $note->setRelation('author', $author);
        $note->setRelation('sender', $author);
        $note->setRelation('task', $this->summaryRelation($this->taskSummary($note->task)));

        return $note;
    }
}
