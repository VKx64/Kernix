<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Contact;
use App\Models\Field;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\Task;
use App\Models\TaskSubtask;
use App\Models\TimeSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductionApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
    }

    public function test_task_mutations_require_an_open_time_session_or_explicit_admin_override(): void
    {
        [$client, $project] = $this->workspace();

        $this->postJson('/api/tasks', [
            'project_id' => $project->id,
            'title' => 'Blocked while clocked out',
        ])->assertStatus(409)
            ->assertJson([
                'code' => 'CLOCK_IN_REQUIRED',
            ]);

        $response = $this->postJson('/api/tasks', [
            'project_id' => $project->id,
            'title' => 'Admin override task',
            'estimated_minutes' => 60,
            'admin_override' => true,
        ])->assertCreated()
            ->assertJsonPath('data.project_id', $project->id)
            ->assertJsonPath('data.actual_minutes', 0);

        $this->assertDatabaseHas('tasks', [
            'id' => $response->json('data.id'),
            'title' => 'Admin override task',
            'actual_minutes' => 0,
        ]);
        $this->assertDatabaseHas('clients', ['id' => $client->id]);
    }

    public function test_note_time_is_the_source_of_truth_for_task_and_subtask_actuals(): void
    {
        [, $project] = $this->workspace();
        TimeSession::query()->create([
            'user_id' => $this->admin->id,
            'clock_in_at' => now(),
        ]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Timed task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $first = TaskSubtask::query()->create([
            'task_id' => $task->id,
            'title' => 'First subtask',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $second = TaskSubtask::query()->create([
            'task_id' => $task->id,
            'title' => 'Second subtask',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $created = $this->postJson("/api/tasks/{$task->id}/notes", [
            'body' => 'Initial work log',
            'subtask_id' => $first->id,
            'time_minutes' => 30,
        ])->assertCreated();
        $noteId = $created->json('data.id');

        $this->assertSame(30, $task->fresh()->actual_minutes);
        $this->assertSame(30, $first->fresh()->actual_minutes);

        $this->patchJson("/api/tasks/{$task->id}/notes/{$noteId}", [
            'body' => 'Moved and corrected work log',
            'subtask_id' => $second->id,
            'time_minutes' => 45,
        ])->assertOk();

        $this->assertSame(45, $task->fresh()->actual_minutes);
        $this->assertSame(0, $first->fresh()->actual_minutes);
        $this->assertSame(45, $second->fresh()->actual_minutes);

        $this->deleteJson("/api/tasks/{$task->id}/notes/{$noteId}")
            ->assertNoContent();

        $this->assertSame(0, $task->fresh()->actual_minutes);
        $this->assertSame(0, $second->fresh()->actual_minutes);
    }

    public function test_non_admins_cannot_set_estimates_or_actual_minutes_directly(): void
    {
        [, $project] = $this->workspace();
        $role = Role::query()->create([
            'name' => 'Producer',
            'key_name' => 'producer',
        ]);
        $role->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'time.track'],
            ['permission_key' => 'tasks.view'],
            ['permission_key' => 'tasks.create'],
            ['permission_key' => 'tasks.edit'],
        ]);
        $staff = User::factory()->create(['role_id' => $role->id]);
        TimeSession::query()->create([
            'user_id' => $staff->id,
            'clock_in_at' => now(),
        ]);
        Sanctum::actingAs($staff);

        $this->postJson('/api/tasks', [
            'project_id' => $project->id,
            'title' => 'Estimate injection',
            'estimated_minutes' => 10,
        ])->assertForbidden();

        $taskId = $this->postJson('/api/tasks', [
            'project_id' => $project->id,
            'title' => 'Normal staff task',
        ])->assertCreated()->json('data.id');

        $this->patchJson("/api/tasks/{$taskId}", [
            'actual_minutes' => 999,
        ])->assertUnprocessable();

        $this->assertDatabaseHas('tasks', [
            'id' => $taskId,
            'actual_minutes' => 0,
        ]);
    }

    public function test_single_client_mode_forces_new_records_and_hides_other_clients(): void
    {
        $first = Client::query()->create(['name' => 'Pinned client', 'created_by' => $this->admin->id]);
        $second = Client::query()->create(['name' => 'Hidden client', 'created_by' => $this->admin->id]);
        $visibleProject = Project::query()->create([
            'client_id' => $first->id,
            'name' => 'Visible project',
            'created_by' => $this->admin->id,
        ]);
        $hiddenProject = Project::query()->create([
            'client_id' => $second->id,
            'name' => 'Hidden project',
            'created_by' => $this->admin->id,
        ]);
        $hiddenTask = Task::query()->create([
            'project_id' => $hiddenProject->id,
            'title' => 'Hidden task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        SystemSetting::query()->findOrFail(1)->update([
            'single_client_mode' => true,
            'single_client_id' => $first->id,
        ]);

        $this->getJson('/api/projects')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $visibleProject->id);
        $this->getJson("/api/tasks/{$hiddenTask->id}")->assertNotFound();
        $this->postJson('/api/clients', ['name' => 'Forbidden client'])->assertForbidden();

        $created = $this->postJson('/api/projects', [
            'client_id' => $second->id,
            'name' => 'Forced project',
        ])->assertCreated();
        $this->assertSame($first->id, $created->json('data.client_id'));
    }

    public function test_settings_secrets_are_never_returned_or_written_to_audit_changes(): void
    {
        $response = $this->patchJson('/api/settings/smtp', [
            'smtp_host' => 'mail.example.test',
            'smtp_password' => 'super-secret-value',
        ])->assertOk()
            ->assertJsonPath('data.smtp_host', 'mail.example.test')
            ->assertJsonMissingPath('data.smtp_password');

        $this->assertTrue($response->json('data.has_smtp_password'));
        $this->assertNotSame(
            'super-secret-value',
            DB::table('system_settings')->where('id', 1)->value('smtp_password')
        );
        $this->assertSame('super-secret-value', SystemSetting::query()->findOrFail(1)->smtp_password);
        $audit = AuditLog::query()->where('action', 'settings.update')->latest('id')->firstOrFail();
        $this->assertStringNotContainsString('super-secret-value', json_encode($audit->changes_json));
        $this->assertStringNotContainsString('smtp_password', json_encode($audit->changes_json));

        $this->patchJson('/api/settings/smtp', [
            'smtp_password' => 'replacement-secret-value',
        ])->assertOk();

        $replacementAudit = AuditLog::query()->where('action', 'settings.update')->latest('id')->firstOrFail();
        $encodedChanges = json_encode($replacementAudit->changes_json);
        $this->assertStringNotContainsString('super-secret-value', $encodedChanges);
        $this->assertStringNotContainsString('replacement-secret-value', $encodedChanges);
        $this->assertStringNotContainsString('smtp_password', $encodedChanges);
    }

    public function test_non_admin_user_editors_cannot_take_over_accounts_or_read_private_details(): void
    {
        $role = Role::query()->create([
            'name' => 'User manager',
            'key_name' => 'user_manager',
        ]);
        $role->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'users.view'],
            ['permission_key' => 'users.edit'],
            ['permission_key' => 'users.archive'],
        ]);
        $staff = User::factory()->create(['role_id' => $role->id]);
        $target = User::factory()->create([
            'personal_email' => 'private@example.test',
        ]);
        Sanctum::actingAs($staff);

        $this->patchJson("/api/users/{$this->admin->id}", [
            'password' => 'AttackerPassword123!',
            'password_confirmation' => 'AttackerPassword123!',
        ])->assertForbidden();
        $this->assertTrue(Hash::check('TestOnly-Admin-Password!', $this->admin->fresh()->password_hash));

        $this->patchJson("/api/users/{$target->id}", [
            'password' => 'AttackerPassword123!',
            'password_confirmation' => 'AttackerPassword123!',
        ])->assertForbidden();
        $this->patchJson("/api/users/{$target->id}", [
            'personal_email' => 'overwritten@example.test',
        ])->assertForbidden();

        $this->getJson("/api/users/{$target->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.personal_email')
            ->assertJsonMissingPath('data.password_hash');
    }

    public function test_login_identities_cannot_collide_across_usernames_and_emails(): void
    {
        User::factory()->create([
            'username' => 'existing-user',
            'imagic_email' => 'existing@example.test',
        ]);

        $this->postJson('/api/users', [
            'role_id' => Role::query()->where('key_name', 'admin')->value('id'),
            'username' => 'EXISTING@EXAMPLE.TEST',
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
            'first_name' => 'Collision',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('username');

        $this->patchJson('/api/profile', [
            'personal_email' => 'existing-user',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('personal_email');
    }

    public function test_local_log_mailer_records_email_as_logged_not_sent(): void
    {
        Mail::fake();
        [, $project] = $this->workspace();
        TimeSession::query()->create([
            'user_id' => $this->admin->id,
            'clock_in_at' => now(),
        ]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Email task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $this->postJson("/api/tasks/{$task->id}/emails", [
            'to_addresses' => 'recipient@example.test',
            'subject' => 'Local delivery test',
            'body' => 'This should be logged locally.',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'logged')
            ->assertJsonPath('data.sent_at', null);
    }

    public function test_parent_records_cannot_be_archived_while_active_children_exist(): void
    {
        [$client, $project] = $this->workspace();
        $contact = Contact::query()->create([
            'client_id' => $client->id,
            'first_name' => 'Client contact',
            'created_by' => $this->admin->id,
        ]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Active child task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $this->postJson("/api/projects/{$project->id}/archive")->assertStatus(409);
        $this->postJson("/api/clients/{$client->id}/archive")->assertStatus(409);

        $this->postJson("/api/contacts/{$contact->id}/archive")->assertOk();
        $this->postJson("/api/tasks/{$task->id}/archive", ['admin_override' => true])->assertOk();
        $this->postJson("/api/projects/{$project->id}/archive")->assertOk();
        $this->postJson("/api/clients/{$client->id}/archive")->assertOk();

        $this->postJson("/api/contacts/{$contact->id}/restore")->assertStatus(409);
        $this->postJson("/api/projects/{$project->id}/restore")->assertStatus(409);
        $this->postJson("/api/tasks/{$task->id}/restore", ['admin_override' => true])->assertStatus(409);
    }

    public function test_required_task_workflow_values_cannot_be_deleted_or_deactivated(): void
    {
        $field = Field::query()->where('key_name', 'task_status')->firstOrFail();
        $value = FieldValue::query()
            ->where('field_id', $field->id)
            ->where('key_name', 'complete')
            ->firstOrFail();

        $this->patchJson("/api/fields/{$field->id}/values/{$value->id}", [
            'status' => 'inactive',
        ])->assertStatus(409);
        $this->deleteJson("/api/fields/{$field->id}/values/{$value->id}")
            ->assertStatus(409);

        $this->assertDatabaseHas('field_values', [
            'id' => $value->id,
            'key_name' => 'complete',
            'status' => 'active',
            'deleted_at' => null,
        ]);
    }

    public function test_non_admin_managers_cannot_escalate_roles_or_assign_a_more_privileged_role(): void
    {
        $managerRole = Role::query()->create([
            'name' => 'Limited manager',
            'key_name' => 'limited_manager',
        ]);
        $managerRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'roles.view'],
            ['permission_key' => 'roles.create'],
            ['permission_key' => 'roles.edit'],
            ['permission_key' => 'roles.delete'],
            ['permission_key' => 'users.view'],
            ['permission_key' => 'users.create'],
            ['permission_key' => 'users.edit'],
        ]);
        $manager = User::factory()->create(['role_id' => $managerRole->id]);
        $higherRole = Role::query()->create([
            'name' => 'Higher privilege',
            'key_name' => 'higher_privilege',
        ]);
        $higherRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'settings.view'],
            ['permission_key' => 'settings.edit'],
        ]);
        Sanctum::actingAs($manager);

        $this->postJson('/api/roles', [
            'name' => 'Escalated role',
            'permissions' => ['settings.edit'],
        ])->assertForbidden();
        $this->patchJson("/api/roles/{$managerRole->id}", [
            'permissions' => ['settings.edit'],
        ])->assertForbidden();

        $this->postJson('/api/users', [
            'role_id' => $higherRole->id,
            'username' => 'escalated-account',
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
            'first_name' => 'Escalated',
        ])->assertForbidden();

        $this->postJson('/api/users', [
            'role_id' => $managerRole->id,
            'username' => 'peer-account',
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
            'first_name' => 'Peer',
        ])->assertCreated();
    }

    public function test_nested_relations_and_bootstrap_lookups_expose_only_safe_summaries(): void
    {
        $client = Client::query()->create([
            'name' => 'Sensitive client',
            'email' => 'private-client@example.test',
            'notes' => 'Confidential client notes',
            'created_by' => $this->admin->id,
        ]);
        $contact = Contact::query()->create([
            'client_id' => $client->id,
            'first_name' => 'Visible contact',
            'created_by' => $this->admin->id,
        ]);
        $assignee = User::factory()->create([
            'imagic_email' => 'private-user@example.test',
            'personal_email' => 'more-private@example.test',
        ]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Sensitive project',
            'description' => 'Confidential project description',
            'manager_user_id' => $assignee->id,
            'created_by' => $this->admin->id,
        ]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Visible task',
            'description' => 'Task details are allowed on the task itself',
            'assignee_user_id' => $assignee->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $clientViewerRole = Role::query()->create(['name' => 'Client viewer', 'key_name' => 'client_viewer']);
        $clientViewerRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'clients.view'],
        ]);
        $clientViewer = User::factory()->create(['role_id' => $clientViewerRole->id]);
        Sanctum::actingAs($clientViewer);
        $this->getJson("/api/clients/{$client->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.contacts')
            ->assertJsonPath('data.contacts_count', 1);

        $contactViewerRole = Role::query()->create(['name' => 'Contact viewer', 'key_name' => 'contact_viewer']);
        $contactViewerRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'contacts.view'],
        ]);
        $contactViewer = User::factory()->create(['role_id' => $contactViewerRole->id]);
        Sanctum::actingAs($contactViewer);
        $this->getJson('/api/contacts')
            ->assertOk()
            ->assertJsonPath('data.0.id', $contact->id)
            ->assertJsonPath('data.0.client.name', 'Sensitive client')
            ->assertJsonMissingPath('data.0.client.email')
            ->assertJsonMissingPath('data.0.client.notes');

        $taskViewerRole = Role::query()->create(['name' => 'Task viewer', 'key_name' => 'task_viewer']);
        $taskViewerRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'tasks.view'],
        ]);
        $taskViewer = User::factory()->create(['role_id' => $taskViewerRole->id]);
        Sanctum::actingAs($taskViewer);
        $this->getJson("/api/tasks/{$task->id}")
            ->assertOk()
            ->assertJsonPath('data.project.name', 'Sensitive project')
            ->assertJsonPath('data.project.client.name', 'Sensitive client')
            ->assertJsonPath('data.assignee.id', $assignee->id)
            ->assertJsonMissingPath('data.project.description')
            ->assertJsonMissingPath('data.project.client.email')
            ->assertJsonMissingPath('data.assignee.imagic_email')
            ->assertJsonMissingPath('data.assignee.personal_email');

        $bootstrap = $this->getJson('/api/bootstrap')->assertOk();
        $this->assertSame([$taskViewerRole->id], collect($bootstrap->json('data.roles'))->pluck('id')->all());
        $this->assertSame(['id', 'name'], array_keys($bootstrap->json('data.clients.0')));
        $this->assertArrayNotHasKey('description', $bootstrap->json('data.projects.0'));
    }

    public function test_disabling_a_user_closes_open_time_and_rotates_sessions_but_active_work_blocks_it(): void
    {
        [, $project] = $this->workspace();
        $target = User::factory()->create(['remember_token' => str_repeat('a', 60)]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Historical completed subtask parent',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        TaskSubtask::query()->create([
            'task_id' => $task->id,
            'title' => 'Already completed assignment',
            'assignee_user_id' => $target->id,
            'actual_minutes' => 0,
            'completed_at' => now(),
            'created_by' => $this->admin->id,
        ]);
        $session = TimeSession::query()->create([
            'user_id' => $target->id,
            'clock_in_at' => now()->subHour(),
        ]);
        $break = $session->breaks()->create(['start_at' => now()->subMinutes(15)]);

        $this->patchJson("/api/users/{$target->id}", ['status' => 'inactive'])
            ->assertOk()
            ->assertJsonPath('data.status', 'inactive');

        $this->assertNotNull($session->fresh()->clock_out_at);
        $this->assertNotNull($break->fresh()->end_at);
        $this->assertNotSame(str_repeat('a', 60), $target->fresh()->remember_token);

        $manager = User::factory()->create();
        $project->update(['manager_user_id' => $manager->id]);
        $this->patchJson("/api/users/{$manager->id}", ['status' => 'inactive'])
            ->assertStatus(409);
        $this->assertSame('active', $manager->fresh()->status);
    }

    public function test_new_tasks_fall_back_to_the_actor_when_the_project_manager_is_inactive(): void
    {
        [, $project] = $this->workspace();
        $manager = User::factory()->create();
        $project->update(['manager_user_id' => $manager->id]);
        $manager->update(['status' => 'inactive']);

        $this->postJson('/api/tasks', [
            'project_id' => $project->id,
            'title' => 'Safe fallback assignment',
            'admin_override' => true,
        ])->assertCreated()
            ->assertJsonPath('data.assignee_user_id', $this->admin->id);
    }

    public function test_explicit_non_message_notes_do_not_auto_notify_the_task_assignee(): void
    {
        [, $project] = $this->workspace();
        $assignee = User::factory()->create();
        TimeSession::query()->create([
            'user_id' => $this->admin->id,
            'clock_in_at' => now(),
        ]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'No notification task',
            'assignee_user_id' => $assignee->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $noteId = $this->postJson("/api/tasks/{$task->id}/notes", [
            'body' => 'This is deliberately only a note.',
            'is_message' => false,
        ])->assertCreated()
            ->assertJsonPath('data.is_message', false)
            ->assertJsonPath('data.assigned_user_id', null)
            ->json('data.id');

        $this->assertDatabaseHas('task_notes', [
            'id' => $noteId,
            'assigned_user_id' => null,
            'is_message' => false,
        ]);
    }

    public function test_admin_time_reads_auto_close_stale_sessions_at_the_twenty_four_hour_boundary(): void
    {
        $target = User::factory()->create();
        $startedAt = now()->subHours(26)->startOfSecond();
        $session = TimeSession::query()->create([
            'user_id' => $target->id,
            'clock_in_at' => $startedAt,
        ]);
        $break = $session->breaks()->create(['start_at' => $startedAt->copy()->addHour()]);

        $this->getJson('/api/time/clocked-users')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $expectedClose = $startedAt->copy()->addDay();
        $this->assertTrue($session->fresh()->clock_out_at->equalTo($expectedClose));
        $this->assertTrue($break->fresh()->end_at->equalTo($expectedClose));

        $this->getJson('/api/time/summary?from='.$startedAt->toDateString().'&to='.now()->toDateString())
            ->assertOk()
            ->assertJsonPath('data.total_minutes', 60);
    }

    /**
     * @return array{Client, Project}
     */
    private function workspace(): array
    {
        $client = Client::query()->create([
            'name' => 'Example client',
            'created_by' => $this->admin->id,
        ]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Example project',
            'created_by' => $this->admin->id,
        ]);

        return [$client, $project];
    }
}
