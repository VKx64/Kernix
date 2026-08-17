<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Models\WhatsAppChat;
use App\Support\TaskAssigneeSync;
use App\Support\TaskStatuses;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Turns what the assistant read in a chat into real tasks.
 *
 * The clock gate is deliberately not applied here, and that is the one place this
 * slice departs from the web client's rules. The gate exists so a person cannot
 * record work they are not on the clock for; a client reporting a bug at
 * midnight is not recording work, and refusing the report because nobody was
 * clocked in would lose it. So the task is raised, and it is raised *visibly*:
 * every one carries a note saying which chat it came from and who said what, and
 * an audit row naming the assistant as the actor. Nothing is silently authored.
 *
 * Who it lands on, in order: the person the conversation named, then the project
 * manager, then whoever the assistant is running as. It is never left unassigned,
 * because an unassigned task raised by a robot is a task nobody reads.
 */
class WhatsAppTaskFactory
{
    /**
     * @param  array<int, array<string, mixed>>  $drafts
     * @return array<int, Task>
     */
    public function create(WhatsAppChat $chat, Project $project, array $drafts, string $source): array
    {
        $actor = $this->actor($project);
        $created = [];

        foreach ($drafts as $draft) {
            $created[] = $this->one($chat, $project, $draft, $actor, $source);
        }

        return array_values(array_filter($created));
    }

    private function one(WhatsAppChat $chat, Project $project, array $draft, ?User $actor, string $source): ?Task
    {
        $title = trim((string) ($draft['title'] ?? ''));
        if ($title === '') {
            return null;
        }

        $assignee = $this->assignee($draft['assignee_name'] ?? null, $project, $actor);

        $task = DB::transaction(function () use ($chat, $project, $draft, $actor, $assignee, $title, $source) {
            $task = Task::create([
                'project_id' => $project->id,
                'title' => $title,
                'description' => $this->description($chat, $draft, $source),
                'status_value_id' => TaskStatuses::id('pending'),
                'type_value_id' => $this->value('task_type', (string) ($draft['type'] ?? 'task')),
                'urgency_value_id' => $this->value('task_urgency', (string) ($draft['urgency'] ?? 'normal')),
                'due_date' => $this->due($draft['due_date'] ?? null),
                'estimated_minutes' => $draft['estimated_minutes'] ?? null,
                'actual_minutes' => 0,
                'created_by' => $actor?->id,
            ]);

            if ($assignee) {
                TaskAssigneeSync::apply($task, [$assignee->id]);
            }

            // The provenance lives on the task, not only in a log file: whoever
            // picks this up needs to know it came out of a chat and be able to
            // check the wording against what was actually said.
            $task->notes()->create([
                'body' => sprintf(
                    'Raised from WhatsApp — %s. %s',
                    $chat->label(),
                    $source === WhatsAppConversationAnalyst::INTAKE
                        ? 'The client reported this in their own chat.'
                        : 'A member of the studio asked for the conversation to be turned into work.'
                ),
                'created_by' => $actor?->id,
                'actor_type' => 'whatsapp',
                'is_message' => false,
            ]);

            return $task;
        });

        AuditLog::create([
            'user_id' => $actor?->id,
            'action' => 'task.create.whatsapp',
            'entity_type' => 'Task',
            'entity_id' => $task->id,
            'summary' => 'task.create.whatsapp '.$chat->label(),
            'changes_json' => [
                'chat_id' => $chat->id,
                'chat' => $chat->label(),
                'source' => $source,
                'assignee_user_id' => $assignee?->id,
            ],
        ]);

        return $task;
    }

    /**
     * Who the assistant acts as. A configured account wins, because a studio may
     * want the robot's work visibly separate from a person's; otherwise the
     * project's manager, who is accountable for the project anyway.
     */
    public function actor(Project $project): ?User
    {
        $configured = (int) config('services.whatsapp.actor_user_id');
        if ($configured > 0) {
            $user = User::query()->withoutGlobalScope('workspace')->where('status', 'active')->find($configured);
            if ($user) {
                return $user;
            }
        }

        if ($project->manager_user_id) {
            $manager = User::query()->withoutGlobalScope('workspace')->where('status', 'active')->find($project->manager_user_id);
            if ($manager) {
                return $manager;
            }
        }

        return User::query()
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->orderBy('id')
            ->first();
    }

    /** The person the conversation named, matched against the workspace's own people. */
    public function assignee(?string $name, Project $project, ?User $fallbackActor): ?User
    {
        $needle = mb_strtolower(trim((string) $name));

        if ($needle !== '') {
            $match = User::query()
                ->where('status', 'active')
                ->whereNull('archived_at')
                ->get(['id', 'first_name', 'last_name', 'username'])
                ->first(function (User $user) use ($needle) {
                    $full = mb_strtolower(trim($user->first_name.' '.$user->last_name));
                    $first = mb_strtolower((string) $user->first_name);

                    return $full === $needle
                        || $first === $needle
                        || mb_strtolower((string) $user->username) === $needle
                        || ($first !== '' && str_starts_with($needle, $first.' '));
                });

            if ($match) {
                return $match;
            }
        }

        if ($project->manager_user_id) {
            $manager = User::query()->where('status', 'active')->find($project->manager_user_id);
            if ($manager) {
                return $manager;
            }
        }

        return $fallbackActor;
    }

    private function description(WhatsAppChat $chat, array $draft, string $source): string
    {
        $body = trim((string) ($draft['description'] ?? ''));
        $origin = sprintf(
            "\n\n---\nFrom WhatsApp: %s%s",
            $chat->label(),
            $source === WhatsAppConversationAnalyst::INTAKE ? ' (client report)' : ' (asked for by the studio)',
        );

        return mb_substr($body.$origin, 0, 20000);
    }

    private function due(mixed $value): ?string
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return null;
        }

        // A date the model read off "by Friday" can land in the past when the
        // conversation is old. A due date already gone would show as overdue the
        // moment it is created, so it is dropped rather than trusted.
        return Carbon::parse($value)->isBefore(today()) ? null : $value;
    }

    private function value(string $field, string $key): ?int
    {
        $id = FieldValue::query()
            ->where('key_name', $key)
            ->whereHas('field', fn ($query) => $query->where('key_name', $field))
            ->value('id');

        return $id === null ? null : (int) $id;
    }
}
