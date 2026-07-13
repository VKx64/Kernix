<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Contact;
use App\Models\Field;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\PermissionCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class PermissionMatrixTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
    }

    /**
     * Every assignable key is exercised in all four authorization modes.
     *
     * @return array<string, array{string, string}>
     */
    public static function permissionMatrix(): array
    {
        $matrix = [];
        foreach (PermissionCatalog::keys() as $key) {
            foreach (['unauthenticated', 'missing', 'exact', 'admin'] as $mode) {
                $matrix[$key.' | '.$mode] = [$key, $mode];
            }
        }

        return $matrix;
    }

    #[DataProvider('permissionMatrix')]
    public function test_every_permission_has_complete_endpoint_authorization_coverage(string $key, string $mode): void
    {
        $actor = match ($mode) {
            'unauthenticated' => $this->admin,
            'missing' => $this->actorWith($key === 'dashboard.view' ? [] : ['dashboard.view']),
            'exact' => $this->actorWith($this->permissionClosure($key)),
            'admin' => $this->admin,
        };

        if ($mode === 'admin') {
            // The system role remains privileged even if its materialized rows
            // are missing, proving the bypass is not an accidental seeded grant.
            DB::table('role_permissions')->where('role_id', $this->admin->role_id)->delete();
            $this->admin->unsetRelation('role');
        }

        if ($this->isTaskMutation($key)) {
            TimeSession::query()->create([
                'user_id' => $actor->id,
                'clock_in_at' => now(),
            ]);
        }

        $operation = $this->operation($key, $actor);
        if ($mode !== 'unauthenticated') {
            Sanctum::actingAs($actor);
        }

        $before = $this->databaseFingerprint();
        $response = $this->json($operation['method'], $operation['path'], $operation['payload']);
        $after = $this->databaseFingerprint();

        if ($mode === 'unauthenticated') {
            $response->assertUnauthorized();
            $this->assertSame($before, $after, "Unauthenticated {$key} request mutated the database.");

            return;
        }

        if ($mode === 'missing') {
            $response->assertForbidden();
            $this->assertSame($before, $after, "Denied {$key} request mutated the database.");

            return;
        }

        $response->assertStatus($operation['status']);
        if ($operation['mutates']) {
            $this->assertNotSame($before, $after, "Successful {$key} operation did not perform its expected mutation.");
        } else {
            $this->assertSame($before, $after, "Read-only {$key} operation unexpectedly mutated the database.");
        }
    }

    /**
     * @return array{method: string, path: string, payload: array<string, mixed>, status: int, mutates: bool}
     */
    private function operation(string $key, User $actor): array
    {
        return match ($key) {
            'dashboard.view' => $this->request('GET', '/api/dashboard'),
            'messages.view' => $this->request('GET', '/api/messages'),
            'time.track' => $this->request('POST', '/api/time/clock-in', [], 201, true),
            'time.view_team' => $this->request('GET', '/api/time/clocked-users'),
            'tasks.view' => $this->taskRequest($actor, 'GET', '/api/tasks'),
            'tasks.create' => $this->taskCreateRequest($actor),
            'tasks.edit' => $this->taskPatchRequest($actor, ['title' => 'Matrix edited task']),
            'tasks.change_status' => $this->taskPatchRequest($actor, [
                'status_value_id' => $this->fieldValue('task_status', 'complete')->id,
            ]),
            'tasks.comment' => $this->taskChildRequest($actor, 'notes', ['body' => 'Matrix comment']),
            'tasks.log_time' => $this->taskChildRequest($actor, 'notes', ['body' => 'Matrix time log', 'time_minutes' => 15]),
            'tasks.subtasks' => $this->taskChildRequest($actor, 'subtasks', ['title' => 'Matrix subtask']),
            'tasks.assign' => $this->taskPatchRequest($actor, [
                'assignee_user_id' => User::factory()->create()->id,
            ]),
            'tasks.estimate' => $this->taskPatchRequest($actor, ['estimated_minutes' => 30]),
            'tasks.email' => $this->taskEmailRequest($actor),
            'tasks.archive' => $this->taskArchiveRequest($actor),
            'projects.view' => $this->request('GET', '/api/projects'),
            'projects.create' => $this->projectCreateRequest($actor),
            'projects.edit' => $this->projectPatchRequest($actor, ['name' => 'Matrix edited project']),
            'projects.archive' => $this->projectArchiveRequest($actor),
            'clients.view' => $this->request('GET', '/api/clients'),
            'clients.create' => $this->request('POST', '/api/clients', ['name' => 'Matrix created client'], 201, true),
            'clients.edit' => $this->clientPatchRequest($actor),
            'clients.archive' => $this->clientArchiveRequest($actor),
            'contacts.view' => $this->request('GET', '/api/contacts'),
            'contacts.create' => $this->contactCreateRequest($actor),
            'contacts.edit' => $this->contactPatchRequest($actor),
            'contacts.archive' => $this->contactArchiveRequest($actor),
            'users.view' => $this->request('GET', '/api/users'),
            'users.create' => $this->userCreateRequest($actor),
            'users.edit' => $this->userPatchRequest($actor),
            'users.archive' => $this->userArchiveRequest($actor),
            'roles.view' => $this->request('GET', '/api/roles'),
            'settings.view' => $this->request('GET', '/api/settings'),
            'settings.edit' => $this->request('PATCH', '/api/settings', ['default_timezone' => 'UTC'], 200, true),
            'fields.view' => $this->request('GET', '/api/fields'),
            'fields.create' => $this->request('POST', '/api/fields', [
                'name' => 'Matrix created field '.$actor->id,
                'key_name' => 'matrix_created_field_'.$actor->id,
            ], 201, true),
            'fields.edit' => $this->fieldPatchRequest($actor),
            'fields.delete' => $this->fieldDeleteRequest($actor),
            'analytics.view' => $this->request('GET', '/api/analytics'),
        };
    }

    private function taskCreateRequest(User $actor): array
    {
        [, $project] = $this->workspace($actor);

        return $this->request('POST', '/api/tasks', [
            'project_id' => $project->id,
            'title' => 'Matrix created task',
        ], 201, true);
    }

    private function taskPatchRequest(User $actor, array $payload): array
    {
        $task = $this->task($actor);

        return $this->request('PATCH', '/api/tasks/'.$task->id, $payload, 200, true);
    }

    private function taskChildRequest(User $actor, string $child, array $payload): array
    {
        $task = $this->task($actor);

        return $this->request('POST', '/api/tasks/'.$task->id.'/'.$child, $payload, 201, true);
    }

    private function taskEmailRequest(User $actor): array
    {
        $task = $this->task($actor);

        return $this->request('GET', '/api/tasks/'.$task->id.'/emails');
    }

    private function taskArchiveRequest(User $actor): array
    {
        $task = $this->task($actor);

        return $this->request('POST', '/api/tasks/'.$task->id.'/archive', [], 200, true);
    }

    private function taskRequest(User $actor, string $method, string $path): array
    {
        $this->task($actor);

        return $this->request($method, $path);
    }

    private function projectCreateRequest(User $actor): array
    {
        $client = $this->client($actor);

        return $this->request('POST', '/api/projects', [
            'client_id' => $client->id,
            'name' => 'Matrix created project',
        ], 201, true);
    }

    private function projectPatchRequest(User $actor, array $payload): array
    {
        [, $project] = $this->workspace($actor);

        return $this->request('PATCH', '/api/projects/'.$project->id, $payload, 200, true);
    }

    private function projectArchiveRequest(User $actor): array
    {
        [, $project] = $this->workspace($actor);

        return $this->request('POST', '/api/projects/'.$project->id.'/archive', [], 200, true);
    }

    private function clientPatchRequest(User $actor): array
    {
        $client = $this->client($actor);

        return $this->request('PATCH', '/api/clients/'.$client->id, ['name' => 'Matrix edited client'], 200, true);
    }

    private function clientArchiveRequest(User $actor): array
    {
        $client = $this->client($actor);

        return $this->request('POST', '/api/clients/'.$client->id.'/archive', [], 200, true);
    }

    private function contactCreateRequest(User $actor): array
    {
        $client = $this->client($actor);

        return $this->request('POST', '/api/contacts', [
            'client_id' => $client->id,
            'first_name' => 'Matrix contact',
        ], 201, true);
    }

    private function contactPatchRequest(User $actor): array
    {
        $contact = $this->contact($actor);

        return $this->request('PATCH', '/api/contacts/'.$contact->id, ['first_name' => 'Matrix edited contact'], 200, true);
    }

    private function contactArchiveRequest(User $actor): array
    {
        $contact = $this->contact($actor);

        return $this->request('POST', '/api/contacts/'.$contact->id.'/archive', [], 200, true);
    }

    private function userCreateRequest(User $actor): array
    {
        return $this->request('POST', '/api/users', [
            'role_id' => $actor->role_id,
            'username' => 'matrix-created-'.$actor->id,
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
            'first_name' => 'Matrix Created',
        ], 201, true);
    }

    private function userPatchRequest(User $actor): array
    {
        $target = User::factory()->create(['role_id' => $actor->role_id]);

        return $this->request('PATCH', '/api/users/'.$target->id, ['first_name' => 'Matrix Edited'], 200, true);
    }

    private function userArchiveRequest(User $actor): array
    {
        $target = User::factory()->create(['role_id' => $actor->role_id]);

        return $this->request('POST', '/api/users/'.$target->id.'/archive', [], 200, true);
    }

    private function fieldPatchRequest(User $actor): array
    {
        $field = $this->field($actor);

        return $this->request('PATCH', '/api/fields/'.$field->id, ['name' => 'Matrix edited field'], 200, true);
    }

    private function fieldDeleteRequest(User $actor): array
    {
        $field = $this->field($actor);

        return $this->request('DELETE', '/api/fields/'.$field->id, [], 204, true);
    }

    private function client(User $actor): Client
    {
        return Client::query()->create([
            'name' => 'Matrix client '.$actor->id,
            'created_by' => $this->admin->id,
        ]);
    }

    /** @return array{Client, Project} */
    private function workspace(User $actor): array
    {
        $client = $this->client($actor);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Matrix project '.$actor->id,
            'created_by' => $this->admin->id,
        ]);

        return [$client, $project];
    }

    private function task(User $actor): Task
    {
        [, $project] = $this->workspace($actor);

        return Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Matrix task '.$actor->id,
            'status_value_id' => $this->fieldValue('task_status', 'pending')->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
    }

    private function contact(User $actor): Contact
    {
        return Contact::query()->create([
            'client_id' => $this->client($actor)->id,
            'first_name' => 'Matrix contact',
            'created_by' => $this->admin->id,
        ]);
    }

    private function field(User $actor): Field
    {
        return Field::query()->create([
            'name' => 'Matrix field '.$actor->id,
            'key_name' => 'matrix_field_'.$actor->id,
            'is_system' => false,
            'sort_order' => 99,
        ]);
    }

    private function fieldValue(string $field, string $key): FieldValue
    {
        return FieldValue::query()
            ->where('key_name', $key)
            ->whereHas('field', fn ($query) => $query->where('key_name', $field))
            ->firstOrFail();
    }

    /** @param array<int, string> $permissions */
    private function actorWith(array $permissions): User
    {
        $role = Role::query()->create([
            'name' => 'Matrix role '.str()->random(8),
            'key_name' => 'matrix_role_'.str()->lower(str()->random(12)),
            'is_system' => false,
            'sort_order' => 99,
        ]);
        $role->permissions()->createMany(array_map(
            fn (string $permission): array => ['permission_key' => $permission],
            array_values(array_unique($permissions))
        ));

        return User::factory()->create(['role_id' => $role->id]);
    }

    /** @return array<int, string> */
    private function permissionClosure(string $key): array
    {
        $permissions = ['dashboard.view'];
        $visit = function (string $permission) use (&$visit, &$permissions): void {
            if (in_array($permission, $permissions, true)) {
                return;
            }
            foreach (PermissionCatalog::requires($permission) as $dependency) {
                $visit($dependency);
            }
            $permissions[] = $permission;
        };
        $visit($key);

        return $permissions;
    }

    private function isTaskMutation(string $key): bool
    {
        return in_array($key, [
            'tasks.create', 'tasks.edit', 'tasks.change_status', 'tasks.comment', 'tasks.log_time',
            'tasks.subtasks', 'tasks.assign', 'tasks.estimate', 'tasks.archive',
        ], true);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{method: string, path: string, payload: array<string, mixed>, status: int, mutates: bool}
     */
    private function request(string $method, string $path, array $payload = [], int $status = 200, bool $mutates = false): array
    {
        return compact('method', 'path', 'payload', 'status', 'mutates');
    }

    private function databaseFingerprint(): string
    {
        $tables = [
            'roles', 'role_permissions', 'fields', 'field_values', 'users', 'clients', 'contacts',
            'projects', 'tasks', 'task_subtasks', 'task_notes', 'task_emails', 'time_sessions',
            'time_breaks', 'system_settings', 'audit_logs', 'sessions', 'personal_access_tokens',
        ];
        $snapshot = [];
        foreach ($tables as $table) {
            $snapshot[$table] = DB::table($table)->get()
                ->map(fn (object $row): array => (array) $row)
                ->sortBy(fn (array $row): string => json_encode($row, JSON_THROW_ON_ERROR))
                ->values()
                ->all();
        }

        return hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR));
    }
}
