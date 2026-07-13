<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Field;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;

abstract class ApiController extends Controller
{
    protected function paginated(LengthAwarePaginator $page): JsonResponse
    {
        return response()->json([
            'data' => $page->items(),
            'meta' => [
                'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(),
                'per_page' => $page->perPage(), 'total' => $page->total(),
            ],
        ]);
    }

    protected function perPage(Request $request): int
    {
        return max(1, min(100, $request->integer('per_page', 25)));
    }

    protected function data(mixed $data, int $status = 200): JsonResponse
    {
        return response()->json(['data' => $data], $status);
    }

    protected function permission(Request $request, string $key): void
    {
        abort_unless($request->user()->canDo($key), 403, 'You do not have permission to perform this action.');
    }

    protected function audit(Request $request, string $action, mixed $model, ?array $changes = null): void
    {
        AuditLog::create([
            'user_id' => $request->user()?->id,
            'action' => $action,
            'entity_type' => is_object($model) ? class_basename($model) : null,
            'entity_id' => is_object($model) ? $model->getKey() : null,
            'summary' => $action.' '.(is_object($model) ? class_basename($model) : ''),
            'changes_json' => $this->sanitizeAudit($changes),
            'ip_address' => $request->ip(),
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 500),
        ]);
    }

    /**
     * Archived records are distinct from soft-deleted records. `only`/`1`
     * shows archived rows, `with` includes both, and the default is active.
     */
    protected function archived(Builder $query, Request $request): Builder
    {
        $mode = strtolower((string) $request->query('archived', ''));

        return match ($mode) {
            'only', '1', 'true', 'archived' => $query->whereNotNull($query->qualifyColumn('archived_at')),
            'with', 'all' => $query,
            default => $query->whereNull($query->qualifyColumn('archived_at')),
        };
    }

    protected function fieldValueRule(string $fieldKey): Exists
    {
        $fieldId = Field::query()->where('key_name', $fieldKey)->value('id') ?? 0;

        return Rule::exists('field_values', 'id')->where(
            fn ($query) => $query->where('field_id', $fieldId)->whereNull('deleted_at')->where('status', 'active')
        );
    }

    protected function clientSummary(?Client $client): ?array
    {
        return $client ? ['id' => $client->id, 'name' => $client->name] : null;
    }

    protected function projectSummary(?Project $project): ?array
    {
        if (! $project) {
            return null;
        }

        return [
            'id' => $project->id,
            'client_id' => $project->client_id,
            'name' => $project->name,
            'client' => $this->clientSummary($project->client),
        ];
    }

    protected function taskSummary(?Task $task): ?array
    {
        if (! $task) {
            return null;
        }

        return [
            'id' => $task->id,
            'project_id' => $task->project_id,
            'title' => $task->title,
            'project' => $this->projectSummary($task->project),
        ];
    }

    protected function userSummary(?User $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            'id' => $user->id,
            'username' => $user->username,
            'first_name' => $user->first_name,
            'last_name' => $user->last_name,
            'name' => trim($user->first_name.' '.$user->last_name),
            'profile_image' => $user->profile_image,
        ];
    }

    protected function summaryRelation(?array $summary): ?Collection
    {
        return $summary === null ? null : collect($summary);
    }

    private function sanitizeAudit(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        $safe = [];
        foreach ($value as $key => $item) {
            $normalized = strtolower((string) $key);
            if (preg_match('/(?:password|secret|token|authorization|access_key|private_key|remember)/', $normalized)) {
                continue;
            }
            $safe[$key] = $this->sanitizeAudit($item);
        }

        return $safe;
    }
}
