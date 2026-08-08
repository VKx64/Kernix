<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\TaskSignals;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskTriageApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        TaskSignals::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);

        $client = Client::query()->create(['name' => 'Triage client', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Triage project',
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_invalid_view_is_rejected(): void
    {
        $this->getJson('/api/tasks?view=bogus')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('view');
    }

    public function test_view_triage_matches_overdue_blocked_review_and_unassigned_urgent_tasks(): void
    {
        $other = User::factory()->create();

        $overdue = $this->makeTask('Overdue task', ['due_date' => now()->subDay()->toDateString()]);
        $blocked = $this->makeTask('Blocked task', ['status_value_id' => $this->statusId('blocked'), 'due_date' => now()->addWeek()->toDateString()]);
        $review = $this->makeTask('In review task', ['status_value_id' => $this->statusId('quality_check'), 'due_date' => now()->addWeek()->toDateString()]);
        $urgentUnassigned = $this->makeTask('Urgent unassigned task', [
            'urgency_value_id' => $this->urgencyId('urgent'),
            'assignee_user_id' => null,
            'due_date' => now()->addWeek()->toDateString(),
        ]);
        $this->makeTask('Quiet future task', [
            'due_date' => now()->addWeek()->toDateString(),
            'assignee_user_id' => $other->id,
        ]);
        $this->makeTask('Done task', [
            'status_value_id' => $this->statusId('complete'),
            'due_date' => now()->subDay()->toDateString(),
        ]);

        $response = $this->getJson('/api/tasks?view=triage')->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->all();

        $this->assertEqualsCanonicalizing(
            [$overdue->id, $blocked->id, $review->id, $urgentUnassigned->id],
            $ids,
        );
    }

    public function test_view_unassigned_and_assignee_filter_none_both_exclude_assigned_and_done_tasks(): void
    {
        $other = User::factory()->create();
        $unassigned = $this->makeTask('Unassigned open task', ['assignee_user_id' => null]);
        $this->makeTask('Assigned task', ['assignee_user_id' => $other->id]);
        $this->makeTask('Unassigned done task', [
            'assignee_user_id' => null,
            'status_value_id' => $this->statusId('complete'),
        ]);

        $this->getJson('/api/tasks?view=unassigned')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $unassigned->id);

        $this->getJson('/api/tasks?assignee_user_id=none')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_counts_are_present_ignore_view_but_respect_search(): void
    {
        $this->makeTask('Searchable alpha task');
        $this->makeTask('Searchable beta task', ['status_value_id' => $this->statusId('complete')]);
        $this->makeTask('Unrelated task');

        $response = $this->getJson('/api/tasks?view=done&search=Searchable')->assertOk();

        $response->assertJsonStructure(['counts' => ['triage', 'mine', 'all', 'unassigned', 'done']]);
        $this->assertSame(1, $response->json('counts.done'));
        $this->assertSame(1, $response->json('counts.all'));
        // The view itself still narrows the returned page to the "done" tab.
        $this->assertSame(1, $response->json('meta.total'));
    }

    public function test_field_value_payload_exposes_role_and_rank(): void
    {
        $response = $this->getJson('/api/bootstrap')->assertOk();
        $fields = collect($response->json('data.fields'));
        $statusField = $fields->firstWhere('key_name', 'task_status');
        $urgencyField = $fields->firstWhere('key_name', 'task_urgency');

        $blockedValue = collect($statusField['values'])->firstWhere('key_name', 'blocked');
        $urgentValue = collect($urgencyField['values'])->firstWhere('key_name', 'urgent');

        $this->assertSame('blocked', $blockedValue['role']);
        $this->assertNull($blockedValue['rank']);
        $this->assertSame(0, $urgentValue['rank']);
        $this->assertNull($urgentValue['role']);
    }

    private function makeTask(string $title, array $overrides = []): Task
    {
        return Task::query()->create(array_merge([
            'project_id' => $this->project->id,
            'title' => $title,
            'status_value_id' => $this->statusId('pending'),
            'urgency_value_id' => $this->urgencyId('normal'),
            'type_value_id' => FieldValue::query()->where('key_name', 'task')
                ->whereHas('field', fn ($field) => $field->where('key_name', 'task_type'))->value('id'),
            'assignee_user_id' => $this->admin->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ], $overrides));
    }

    private function statusId(string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_status'))->value('id');
    }

    private function urgencyId(string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_urgency'))->value('id');
    }
}
