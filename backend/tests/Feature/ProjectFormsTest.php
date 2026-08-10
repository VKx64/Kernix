<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FormSubmission;
use App\Models\Project;
use App\Models\ProjectForm;
use App\Models\User;
use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProjectFormsTest extends TestCase
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
        Sanctum::actingAs($this->admin);
        $client = Client::query()->create(['name' => 'Northwind Health', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create(['client_id' => $client->id, 'name' => 'Patient Portal', 'created_by' => $this->admin->id]);
    }

    public function test_admin_creates_a_form_and_a_member_of_another_workspace_gets_404(): void
    {
        $created = $this->postJson("/api/projects/{$this->project->id}/forms", [
            'title' => 'Bug reports',
            'blurb' => 'Tell us what broke.',
            'fields' => [
                ['type' => 'short_text', 'label' => 'What went wrong?', 'required' => true, 'maps' => 'title'],
            ],
        ])->assertCreated()
            ->assertJsonPath('data.title', 'Bug reports')
            ->assertJsonPath('data.state', 'live');
        $formId = $created->json('data.id');
        $slug = $created->json('data.slug');
        $this->assertSame(32, strlen($slug));

        [$otherWorkspace, $stranger] = $this->otherWorkspace();
        Sanctum::actingAs($stranger);
        $this->getJson("/api/project-forms/{$formId}")->assertNotFound();
    }

    public function test_twelve_field_cap_is_enforced(): void
    {
        $fields = [];
        for ($i = 0; $i < 13; $i++) {
            $fields[] = ['type' => 'select', 'label' => "Field {$i}", 'maps' => 'none', 'choices' => [
                ['value' => 'a', 'label' => 'A'], ['value' => 'b', 'label' => 'B'],
            ]];
        }

        $this->postJson("/api/projects/{$this->project->id}/forms", [
            'title' => 'Too many fields', 'fields' => $fields,
        ])->assertStatus(422);
    }

    public function test_field_type_allowlist_is_enforced(): void
    {
        $this->postJson("/api/projects/{$this->project->id}/forms", [
            'title' => 'Bad type',
            'fields' => [['type' => 'multi_select', 'label' => 'Not a real type']],
        ])->assertStatus(422);
    }

    public function test_map_target_uniqueness_is_enforced(): void
    {
        $this->postJson("/api/projects/{$this->project->id}/forms", [
            'title' => 'Duplicate map',
            'fields' => [
                ['type' => 'short_text', 'label' => 'Title one', 'maps' => 'title'],
                ['type' => 'short_text', 'label' => 'Title two', 'maps' => 'title'],
            ],
        ])->assertStatus(422);
    }

    public function test_map_type_compatibility_is_enforced(): void
    {
        $this->postJson("/api/projects/{$this->project->id}/forms", [
            'title' => 'Incompatible map',
            'fields' => [
                ['type' => 'long_text', 'label' => 'Details', 'maps' => 'title'],
            ],
        ])->assertStatus(422);
    }

    public function test_slug_rotation_changes_the_slug_and_leaves_submissions_untouched(): void
    {
        $form = ProjectForm::factory()->create(['project_id' => $this->project->id]);
        $submission = FormSubmission::factory()->create([
            'project_form_id' => $form->id,
            'project_id' => $this->project->id,
        ]);
        $originalSlug = $form->slug;

        $rotateResponse = $this->postJson("/api/project-forms/{$form->id}/rotate-slug")->assertOk();
        $this->assertNotSame($originalSlug, $rotateResponse->json('data.slug'));

        $rotated = $form->fresh();
        $this->assertNotSame($originalSlug, $rotated->slug);
        $this->assertNotNull($rotated->slug_rotated_at);
        $this->assertSame('new', $submission->fresh()->status);
        $this->assertSame($submission->reference, $submission->fresh()->reference);
    }

    public function test_both_presets_create_a_working_live_form_in_one_click(): void
    {
        $bug = $this->postJson("/api/projects/{$this->project->id}/forms", ['preset' => 'bug_report'])
            ->assertCreated()
            ->assertJsonPath('data.state', 'live');
        $this->assertNotEmpty($bug->json('data.fields'));

        $feature = $this->postJson("/api/projects/{$this->project->id}/forms", ['preset' => 'feature_request'])
            ->assertCreated()
            ->assertJsonPath('data.state', 'live');
        $this->assertNotEmpty($feature->json('data.fields'));
    }

    public function test_feature_projects_disabled_403s_every_new_route(): void
    {
        $workspaceId = CurrentWorkspace::forUser($this->admin);
        $workspace = Workspace::query()->findOrFail($workspaceId);
        $form = ProjectForm::factory()->create(['project_id' => $this->project->id]);
        $submission = FormSubmission::factory()->create([
            'project_form_id' => $form->id,
            'project_id' => $this->project->id,
        ]);
        $workspace->update(['feature_projects_enabled' => false]);

        $this->getJson("/api/projects/{$this->project->id}/forms")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson("/api/projects/{$this->project->id}/forms", ['title' => 'x'])->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->getJson("/api/project-forms/{$form->id}")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->patchJson("/api/project-forms/{$form->id}", ['title' => 'y'])->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->deleteJson("/api/project-forms/{$form->id}")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson("/api/project-forms/{$form->id}/rotate-slug")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson("/api/project-forms/{$form->id}/duplicate")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->getJson("/api/project-forms/{$form->id}/submissions")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->getJson("/api/form-submissions/{$submission->id}")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson("/api/form-submissions/{$submission->id}/convert")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson("/api/form-submissions/{$submission->id}/decline")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson("/api/form-submissions/{$submission->id}/reconvert")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
    }

    /** @return array{Workspace, User} */
    private function otherWorkspace(): array
    {
        $owner = User::factory()->create();
        $workspace = WorkspaceProvisioner::provision($owner, 'Rival studio');

        return [$workspace, $owner->fresh()];
    }
}
