<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FormSubmission;
use App\Models\FormSubmissionFile;
use App\Models\Project;
use App\Models\User;
use App\Services\FormSubmissionRetentionService;
use App\Support\CurrentWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FormSubmissionRetentionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        CurrentWorkspace::reset();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        $client = Client::query()->create(['name' => 'Northwind Health', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create(['client_id' => $client->id, 'name' => 'Patient Portal', 'created_by' => $this->admin->id]);
    }

    private function submissionWithFile(array $overrides): FormSubmission
    {
        $submission = FormSubmission::factory()->create($overrides);
        $path = "form-submissions/{$submission->id}/shot.png";
        Storage::disk('local')->put($path, 'bytes');
        FormSubmissionFile::factory()->create([
            'form_submission_id' => $submission->id,
            'storage_path' => $path,
            'file_size' => 5,
        ]);

        return $submission;
    }

    public function test_a_converted_submission_past_the_window_is_pruned_rows_and_files(): void
    {
        $submission = $this->submissionWithFile([
            'status' => 'converted',
            'decided_at' => now()->subDays(200),
        ]);

        $result = app(FormSubmissionRetentionService::class)->prune();

        $this->assertSame(['submissions' => 1, 'files' => 1, 'bytes' => 5], $result);
        $this->assertDatabaseMissing('form_submissions', ['id' => $submission->id]);
        $this->assertDatabaseMissing('form_submission_files', ['form_submission_id' => $submission->id]);
        Storage::disk('local')->assertMissing("form-submissions/{$submission->id}/shot.png");
        Storage::disk('local')->assertDirectoryEmpty("form-submissions/{$submission->id}");
    }

    public function test_a_declined_submission_past_the_window_is_pruned(): void
    {
        $submission = $this->submissionWithFile([
            'status' => 'declined',
            'decided_at' => now()->subDays(200),
        ]);

        $result = app(FormSubmissionRetentionService::class)->prune();

        $this->assertSame(1, $result['submissions']);
        $this->assertDatabaseMissing('form_submissions', ['id' => $submission->id]);
        Storage::disk('local')->assertMissing("form-submissions/{$submission->id}/shot.png");
    }

    public function test_a_new_submission_is_never_pruned_no_matter_how_old(): void
    {
        $submission = $this->submissionWithFile([
            'status' => 'new',
        ]);
        FormSubmission::withoutGlobalScopes()->whereKey($submission->id)->update(['created_at' => now()->subDays(400)]);

        $result = app(FormSubmissionRetentionService::class)->prune();

        $this->assertSame(0, $result['submissions']);
        $this->assertDatabaseHas('form_submissions', ['id' => $submission->id]);
        Storage::disk('local')->assertExists("form-submissions/{$submission->id}/shot.png");
    }

    public function test_a_converted_submission_inside_the_window_is_not_pruned(): void
    {
        $submission = $this->submissionWithFile([
            'status' => 'converted',
            'decided_at' => now()->subDays(100),
        ]);

        $result = app(FormSubmissionRetentionService::class)->prune();

        $this->assertSame(0, $result['submissions']);
        $this->assertDatabaseHas('form_submissions', ['id' => $submission->id]);
        Storage::disk('local')->assertExists("form-submissions/{$submission->id}/shot.png");
    }

    public function test_running_the_command_twice_is_harmless(): void
    {
        $submission = $this->submissionWithFile([
            'status' => 'converted',
            'decided_at' => now()->subDays(200),
        ]);

        $service = app(FormSubmissionRetentionService::class);
        $first = $service->prune();
        $second = $service->prune();

        $this->assertSame(['submissions' => 1, 'files' => 1, 'bytes' => 5], $first);
        $this->assertSame(['submissions' => 0, 'files' => 0, 'bytes' => 0], $second);
        $this->assertDatabaseMissing('form_submissions', ['id' => $submission->id]);
    }

    public function test_running_with_nothing_to_prune_is_harmless(): void
    {
        $result = app(FormSubmissionRetentionService::class)->prune();

        $this->assertSame(['submissions' => 0, 'files' => 0, 'bytes' => 0], $result);
    }

    public function test_artisan_command_runs_and_reports_a_summary(): void
    {
        $submission = $this->submissionWithFile([
            'status' => 'declined',
            'decided_at' => now()->subDays(200),
        ]);

        $this->artisan('form-submissions:prune')
            ->expectsOutputToContain('1 submission(s), 1 file(s), 5 byte(s) reclaimed')
            ->assertExitCode(0);

        $this->assertDatabaseMissing('form_submissions', ['id' => $submission->id]);
    }
}
