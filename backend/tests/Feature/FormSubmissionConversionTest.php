<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FormSubmission;
use App\Models\Project;
use App\Models\ProjectForm;
use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use App\Services\FormSubmissionConverter;
use App\Support\CurrentWorkspace;
use App\Support\SubmissionDuplicates;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FormSubmissionConversionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        CurrentWorkspace::reset();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        $client = Client::query()->create(['name' => 'Northwind Health', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create(['client_id' => $client->id, 'name' => 'Patient Portal', 'created_by' => $this->admin->id]);
    }

    public function test_mapping_is_applied_exactly_from_the_snapshot_and_subtasks_land_as_ordered_rows(): void
    {
        $submission = $this->submission([
            'fl1' => 'Portal logs me out',
            'fl2' => 'Happens on every browser',
            'fl3' => "Log in\nSwitch clinics\n\nObserve logout",
            'fl4' => 'blocking',
            'fl5' => '2026-09-01',
        ]);

        $task = app(FormSubmissionConverter::class)->convert($submission->fresh(), $this->admin);

        $this->assertSame('Portal logs me out', $task->title);
        $this->assertSame('Happens on every browser', $task->description);
        $this->assertSame($this->project->id, $task->project_id);
        $this->assertSame('2026-09-01', $task->due_date->toDateString());
        $this->assertSame($submission->id, $task->form_submission_id);

        $subtasks = $task->subtasks()->orderBy('sort_order')->get();
        $this->assertCount(3, $subtasks);
        $this->assertSame(['Log in', 'Switch clinics', 'Observe logout'], $subtasks->pluck('title')->all());
        $this->assertSame([10, 20, 30], $subtasks->pluck('sort_order')->all());
    }

    public function test_project_id_always_comes_from_the_form_never_the_payload(): void
    {
        $otherClient = Client::query()->create(['name' => 'Other', 'created_by' => $this->admin->id]);
        $otherProject = Project::query()->create(['client_id' => $otherClient->id, 'name' => 'Other project', 'created_by' => $this->admin->id]);

        $submission = $this->submission(['fl1' => 'A report']);
        // There is no request payload path into convert() that accepts a
        // project id at all — the invariant is structural, not validated.
        $task = app(FormSubmissionConverter::class)->convert($submission->fresh(), $this->admin);

        $this->assertSame($this->project->id, $task->project_id);
        $this->assertNotSame($otherProject->id, $task->project_id);
    }

    public function test_critical_maps_to_urgent_and_an_unmapped_choice_falls_back_to_normal_never_null(): void
    {
        $critical = $this->submission(['fl1' => 'Urgent report', 'fl4' => 'blocking']);
        $criticalTask = app(FormSubmissionConverter::class)->convert($critical->fresh(), $this->admin);
        $this->assertSame('urgent', $criticalTask->urgency->key_name);

        $unmapped = $this->submission(['fl1' => 'Odd report', 'fl4' => 'not_a_real_choice']);
        $unmappedTask = app(FormSubmissionConverter::class)->convert($unmapped->fresh(), $this->admin);
        $this->assertSame('normal', $unmappedTask->urgency->key_name);
        $this->assertNotNull($unmappedTask->urgency_value_id);
    }

    public function test_converting_twice_is_rejected_and_exactly_one_task_exists(): void
    {
        Sanctum::actingAs($this->admin);
        $this->clockIn();
        $submission = $this->submission(['fl1' => 'Report']);

        $this->postJson("/api/form-submissions/{$submission->id}/convert")->assertCreated();
        $this->postJson("/api/form-submissions/{$submission->id}/convert")->assertStatus(409);

        $this->assertSame(1, Task::query()->where('form_submission_id', $submission->id)->count());
    }

    public function test_the_database_refuses_a_second_task_for_the_same_submission_even_if_the_state_check_is_bypassed(): void
    {
        // Simulates two racing transactions both passing the "status is new"
        // check before either commits: the unique index on
        // tasks.form_submission_id is what actually prevents two tasks, not
        // just the lockForUpdate + re-assert in the controller.
        $submission = $this->submission(['fl1' => 'Race report']);
        $converter = app(FormSubmissionConverter::class);

        $converter->convert($submission->fresh(), $this->admin);

        $this->expectException(QueryException::class);
        $converter->convert($submission->fresh()->forceFill(['status' => 'new']), $this->admin);
    }

    public function test_declining_a_converted_submission_is_rejected(): void
    {
        Sanctum::actingAs($this->admin);
        $this->clockIn();
        $submission = $this->submission(['fl1' => 'Report']);

        $this->postJson("/api/form-submissions/{$submission->id}/convert")->assertCreated();
        $this->postJson("/api/form-submissions/{$submission->id}/decline")->assertStatus(409);
    }

    public function test_a_soft_deleted_task_can_be_reconverted_exactly_once(): void
    {
        Sanctum::actingAs($this->admin);
        $this->clockIn();
        $submission = $this->submission(['fl1' => 'Report']);
        $taskId = $this->postJson("/api/form-submissions/{$submission->id}/convert")->assertCreated()->json('data.id');

        Task::query()->findOrFail($taskId)->delete();

        $this->postJson("/api/form-submissions/{$submission->id}/reconvert")->assertCreated();
        $this->assertSame('converted', $submission->fresh()->status);
        $newTaskId = $submission->fresh()->task_id;
        $this->assertNotSame($taskId, $newTaskId);
        $this->assertNull(Task::withTrashed()->find($taskId)->form_submission_id);

        // A second reconvert attempt finds an active task and is rejected.
        $this->postJson("/api/form-submissions/{$submission->id}/reconvert")->assertStatus(409);
    }

    public function test_a_clocked_out_reviewer_is_blocked_by_the_controller_but_the_service_is_not(): void
    {
        Sanctum::actingAs($this->admin);
        $submission = $this->submission(['fl1' => 'Report']);

        $this->postJson("/api/form-submissions/{$submission->id}/convert")
            ->assertStatus(409)
            ->assertJsonPath('code', 'CLOCK_IN_REQUIRED');

        // The service itself has no clock gate: this is the auto-convert path.
        $task = app(FormSubmissionConverter::class)->convert($submission->fresh(), null);
        $this->assertNotNull($task->id);
    }

    public function test_submission_duplicate_detection_matches_the_ported_keyword_overlap_rule(): void
    {
        $form = ProjectForm::factory()->create(['project_id' => $this->project->id]);
        $first = FormSubmission::factory()->create([
            'project_form_id' => $form->id,
            'project_id' => $this->project->id,
            'from_email' => 'client@example.com',
            'form_snapshot' => $form->toSnapshot(),
            'answers' => ['fl1' => 'Portal logs me out when switching clinics'],
        ]);
        $second = FormSubmission::factory()->create([
            'project_form_id' => $form->id,
            'project_id' => $this->project->id,
            'from_email' => 'CLIENT@example.com',
            'form_snapshot' => $form->toSnapshot(),
            'answers' => ['fl1' => 'Portal logs me out switching clinics again'],
        ]);
        $unrelated = FormSubmission::factory()->create([
            'project_form_id' => $form->id,
            'project_id' => $this->project->id,
            'from_email' => 'other@example.com',
            'form_snapshot' => $form->toSnapshot(),
            'answers' => ['fl1' => 'Completely different concern here'],
        ]);

        $match = SubmissionDuplicates::find($second->fresh());
        $this->assertNotNull($match);
        $this->assertSame($first->id, $match->id);

        $this->assertNull(SubmissionDuplicates::find($unrelated->fresh()));
    }

    private function clockIn(): void
    {
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);
    }

    private function submission(array $answers): FormSubmission
    {
        $form = ProjectForm::factory()->create([
            'project_id' => $this->project->id,
            'fields' => [
                ['id' => 'fl1', 'type' => 'short_text', 'label' => 'What went wrong?', 'help' => null, 'required' => true, 'choices' => [], 'maps' => 'title', 'min' => null, 'max' => null],
                ['id' => 'fl2', 'type' => 'long_text', 'label' => 'Details', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'description', 'min' => null, 'max' => null],
                ['id' => 'fl3', 'type' => 'steps', 'label' => 'Steps', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'subtasks', 'min' => null, 'max' => null],
                [
                    'id' => 'fl4', 'type' => 'severity', 'label' => 'How bad?', 'help' => null, 'required' => true,
                    'choices' => [
                        ['value' => 'blocking', 'label' => 'Blocking', 'caption' => null, 'urgency_key' => 'critical'],
                        ['value' => 'minor', 'label' => 'Minor', 'caption' => null, 'urgency_key' => 'low'],
                    ],
                    'maps' => 'urgency', 'min' => null, 'max' => null,
                ],
                ['id' => 'fl5', 'type' => 'date', 'label' => 'Deadline', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'due', 'min' => null, 'max' => null],
            ],
            'next_field_seq' => 6,
        ]);

        return FormSubmission::factory()->create([
            'project_form_id' => $form->id,
            'project_id' => $this->project->id,
            'form_snapshot' => $form->toSnapshot(),
            'answers' => $answers,
        ]);
    }
}
