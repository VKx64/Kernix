<?php

namespace App\Services;

use App\Models\Project;
use App\Models\SystemSetting;
use App\Models\User;
use App\Models\WhatsAppChat;
use App\Models\WhatsAppMessage;
use App\Support\AiFeatures;
use Throwable;

/**
 * Reads a WhatsApp conversation and says what work is in it.
 *
 * Two callers, one model call each:
 *
 *  - **requested** — somebody in a project group typed `kernix task`. Everything
 *    said recently is fair game, and the studio has explicitly asked for it.
 *  - **intake** — a client wrote something on their own. This is far more
 *    cautious: only a defect or a clear request becomes work, and everything
 *    else is left as conversation for a human to answer. A chat where every
 *    "thanks, looks good" spawned a task would be abandoned within a week.
 *
 * The model never gets to decide *who* it affects. It may name a person, and that
 * name is matched against the workspace's own active accounts afterwards; an
 * unmatched name falls back to the project manager. It cannot set a status, it
 * cannot touch existing tasks, and its output is not trusted to be well formed —
 * a malformed reply raises nothing at all.
 */
class WhatsAppConversationAnalyst
{
    /** How much of the conversation the model reads. */
    private const TRANSCRIPT_LINES = 40;

    public const REQUESTED = 'requested';

    public const INTAKE = 'intake';

    public function __construct(
        private readonly OpenRouterClient $client,
        private readonly AiUsageService $usage,
    ) {}

    public function available(): bool
    {
        $settings = SystemSetting::query()->find(1);

        return $settings !== null
            && AiFeatures::enabled($settings, AiFeatures::TASK_CREATION)
            && filled($settings->openrouter_api_key)
            && filled($settings->openrouter_model);
    }

    /**
     * Null when the feature is off, the budget is spent, or the model answered in
     * a shape that cannot be acted on.
     *
     * @return array{intent: string, summary: string, reply: string, tasks: array<int, array<string, mixed>>}|null
     */
    public function read(WhatsAppChat $chat, Project $project, string $mode, ?string $instruction = null): ?array
    {
        $settings = SystemSetting::query()->find(1);
        if (! $this->available() || ! $settings) {
            return null;
        }

        try {
            $this->usage->assertAvailable($settings);
        } catch (Throwable) {
            return null;
        }

        try {
            $result = $this->client->structured(
                $settings,
                $this->system($mode),
                $this->context($chat, $project, $mode, $instruction),
                'whatsapp_conversation',
                $this->schema(),
            );
        } catch (Throwable $exception) {
            report($exception);

            return null;
        }

        $this->usage->record('task_creation', 'whatsapp_chat', $chat->id, $result, $project->id);

        $output = is_array($result['output'] ?? null) ? $result['output'] : [];
        $intent = in_array($output['intent'] ?? '', ['create_tasks', 'answer', 'none'], true)
            ? (string) $output['intent']
            : 'none';

        return [
            'intent' => $intent,
            'summary' => trim((string) ($output['summary'] ?? '')),
            'reply' => trim((string) ($output['reply'] ?? '')),
            // Only a turn that says it is raising work carries work, whatever
            // else the array contains.
            'tasks' => $intent === 'create_tasks' ? $this->tasks($output['tasks'] ?? []) : [],
        ];
    }

    private function system(string $mode): string
    {
        $shared = <<<'PROMPT'
        You read WhatsApp conversations for a production studio's project management system and turn them into work.

        Rules that never bend:
        - Only raise work that somebody in the conversation actually asked for or reported. Never invent, never round up a vague worry into a task, never split one request into five.
        - A task title is one line, in the studio's own words, specific enough to act on without the chat open. Put the evidence in the description, quoting who said what.
        - You do not decide who does the work. You may name a person only if the conversation named them.
        - You never promise a date the conversation did not give you. Leave due_date null unless a date was stated or clearly implied ("by Friday").
        - Your reply is read by the people in that chat. Two or three sentences, plain, no lists of what you "processed".
        PROMPT;

        $requested = <<<'PROMPT'

        Mode: REQUESTED. A member of the studio has asked you to turn the recent conversation into tasks. Read what was discussed and raise every distinct piece of work that was agreed or asked for, and nothing else. If the conversation contains no actual work, say so plainly with intent "none" — that is a perfectly good answer.
        PROMPT;

        $intake = <<<'PROMPT'

        Mode: INTAKE. A client wrote in their own chat, unprompted. Be conservative:
        - Raise work only for a reported defect, or an explicit request to build or change something.
        - Praise, thanks, small talk, scheduling chatter, and answers to your own questions are intent "none".
        - A question you cannot answer from the conversation is intent "answer": reply that you have passed it to the project manager. Do not answer it yourself, do not guess at scope, price, or dates.
        - One message may describe several separate defects. Those are separate tasks.
        PROMPT;

        return $shared.($mode === self::INTAKE ? $intake : $requested);
    }

    private function context(WhatsAppChat $chat, Project $project, string $mode, ?string $instruction): string
    {
        $lines = [
            'Project: #'.$project->id.' — '.$project->name,
            'Client: '.($project->client?->name ?? 'unknown'),
            'Chat: '.$chat->label().' ('.($chat->isGroup() ? 'group' : 'one to one').', audience: '.$chat->audience.')',
            'Today: '.now()->toDateString(),
        ];

        $people = $this->people($project);
        if ($people !== []) {
            $lines[] = 'People who can be named as assignee: '.implode(', ', $people);
        }

        if (filled($instruction)) {
            $lines[] = 'What the studio asked you to do: '.trim($instruction);
        }

        $lines[] = '';
        $lines[] = 'Conversation, oldest first:';
        foreach ($this->transcript($chat) as $line) {
            $lines[] = $line;
        }

        return implode("\n", $lines);
    }

    /** @return array<int, string> */
    private function transcript(WhatsAppChat $chat): array
    {
        return $chat->messages()
            ->orderByDesc('id')
            ->limit(self::TRANSCRIPT_LINES)
            ->get()
            ->reverse()
            ->map(fn (WhatsAppMessage $message) => $message->transcriptLine())
            ->values()
            ->all();
    }

    /** @return array<int, string> */
    private function people(Project $project): array
    {
        return User::query()
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->orderBy('first_name')
            ->limit(40)
            ->get(['first_name', 'last_name'])
            ->map(fn (User $user) => trim($user->first_name.' '.$user->last_name))
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function tasks(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }

        $tasks = [];
        foreach ($raw as $item) {
            if (! is_array($item)) {
                continue;
            }
            $title = trim((string) ($item['title'] ?? ''));
            if ($title === '') {
                continue;
            }

            $tasks[] = [
                'title' => mb_substr($title, 0, 191),
                'description' => mb_substr(trim((string) ($item['description'] ?? '')), 0, 5000),
                'type' => in_array($item['type'] ?? '', ['task', 'bug', 'feature', 'request'], true) ? (string) $item['type'] : 'task',
                'urgency' => in_array($item['urgency'] ?? '', ['low', 'normal', 'high'], true) ? (string) $item['urgency'] : 'normal',
                'assignee_name' => filled($item['assignee_name'] ?? null) ? mb_substr((string) $item['assignee_name'], 0, 120) : null,
                'due_date' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($item['due_date'] ?? '')) ? (string) $item['due_date'] : null,
                'estimated_minutes' => is_numeric($item['estimated_minutes'] ?? null)
                    ? max(0, min(100000, (int) $item['estimated_minutes']))
                    : null,
            ];

            // A conversation that turns into a dozen tasks is a conversation
            // somebody needs to read, not a batch to file.
            if (count($tasks) >= 6) {
                break;
            }
        }

        return $tasks;
    }

    /** @return array<string, mixed> */
    private function schema(): array
    {
        return [
            'type' => 'object',
            'additionalProperties' => false,
            'properties' => [
                'intent' => ['type' => 'string', 'enum' => ['create_tasks', 'answer', 'none']],
                'summary' => ['type' => 'string'],
                'reply' => ['type' => 'string'],
                'tasks' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'additionalProperties' => false,
                        'properties' => [
                            'title' => ['type' => 'string'],
                            'description' => ['type' => 'string'],
                            'type' => ['type' => 'string', 'enum' => ['task', 'bug', 'feature', 'request']],
                            'urgency' => ['type' => 'string', 'enum' => ['low', 'normal', 'high']],
                            'assignee_name' => ['type' => ['string', 'null']],
                            'due_date' => ['type' => ['string', 'null']],
                            'estimated_minutes' => ['type' => ['integer', 'null']],
                        ],
                        'required' => ['title', 'description', 'type', 'urgency', 'assignee_name', 'due_date', 'estimated_minutes'],
                    ],
                ],
            ],
            'required' => ['intent', 'summary', 'reply', 'tasks'],
        ];
    }
}
