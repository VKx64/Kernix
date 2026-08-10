<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FormSubmission;
use App\Models\FormSubmissionFile;
use App\Models\Project;
use App\Models\ProjectForm;
use App\Models\Task;
use App\Models\User;
use App\Models\Workspace;
use App\Services\FormSubmissionConverter;
use App\Services\FormSubmissionFileStorage;
use App\Support\CurrentWorkspace;
use App\Support\PublicFormAvailability;
use App\Support\WorkspaceFeatures;
use App\Support\WorkspaceProvisioner;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class PublicFormSubmissionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        CurrentWorkspace::reset();
        Storage::fake('local');
        $this->seed();
    }

    // ------------------------------------------------------------------
    // 1. GET payload is exactly the allowlist, nothing more.
    // ------------------------------------------------------------------
    public function test_public_get_returns_exactly_the_allowed_key_set_and_no_tenant_data(): void
    {
        $form = $this->makeForm(1, ['require_email' => true]);

        $response = $this->getJson("/api/public/forms/{$form->slug}")->assertOk();

        $data = $response->json();
        $this->assertSame(
            ['title', 'blurb', 'header_line', 'closed', 'require_email', 'max_files', 'max_file_bytes', 'max_submission_files', 'max_submission_bytes', 'accepted_types', 'fields'],
            array_keys($data),
        );
        $this->assertFalse($data['closed']);
        $this->assertArrayNotHasKey('closed_message', $data);

        foreach ($data['fields'] as $field) {
            $this->assertSame(
                array_values(array_intersect(array_keys($field), ['id', 'type', 'label', 'help', 'required', 'choices', 'min', 'max'])),
                array_values(array_keys($field)),
            );
            $this->assertArrayNotHasKey('maps', $field);
            foreach ($field['choices'] ?? [] as $choice) {
                $this->assertSame(['value', 'label', 'caption'], array_keys($choice));
                $this->assertArrayNotHasKey('urgency_key', $choice);
            }
        }

        $raw = $response->getContent();
        foreach (['project_id', 'workspace_id', 'client_id', '"created_by"', '"auto_convert"', '"notify"', '"state"', 'closes_on', '"maps"', 'urgency_key', 'project_form_id'] as $needle) {
            $this->assertStringNotContainsString($needle, $raw, "response leaked \"$needle\"");
        }
        $this->assertStringNotContainsString('"id":'.$form->id, $raw);

        $response->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Robots-Tag', 'noindex, nofollow')
            ->assertHeader('Referrer-Policy', 'no-referrer');
        $this->assertNull($response->headers->get('set-cookie'));
    }

    // ------------------------------------------------------------------
    // 2. POST works with no CSRF token / session at all.
    // ------------------------------------------------------------------
    public function test_post_succeeds_with_no_csrf_token_or_session(): void
    {
        $form = $this->makeForm(1);

        $response = $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Something broke on the checkout page'],
        ])->assertCreated();

        $this->assertSame(['reference', 'submitted_at', 'email_on_file'], array_keys($response->json()));
        $this->assertFalse($response->json('email_on_file'));
        $this->assertStringStartsWith('SUB-', $response->json('reference'));
    }

    // ------------------------------------------------------------------
    // 3. Cross-tenant: workspace A has the lower id, submission goes to B.
    // ------------------------------------------------------------------
    public function test_cross_tenant_submission_lands_in_workspace_b_never_the_id_fallback(): void
    {
        $workspaceA = Workspace::query()->findOrFail(1);
        // Give workspace A (the lowest-id tenant) its own unrelated data, so
        // an accidental fall-through to Workspace::orderBy('id') would be
        // provably wrong, not just provably empty.
        CurrentWorkspace::use($workspaceA->id, function () {
            $client = Client::query()->create(['name' => 'Workspace A client']);
            Project::query()->create(['client_id' => $client->id, 'name' => 'Workspace A project']);
        });

        $owner = User::factory()->create();
        $workspaceB = WorkspaceProvisioner::provision($owner, 'Rival studio');
        $this->assertGreaterThan($workspaceA->id, $workspaceB->id);
        $this->assertSame($workspaceA->id, (int) Workspace::query()->orderBy('id')->value('id'));

        $form = $this->makeForm($workspaceB->id);

        $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Report filed against workspace B'],
        ])->assertCreated();

        $submission = FormSubmission::acrossWorkspaces()->where('project_form_id', $form->id)->firstOrFail();
        $this->assertSame($workspaceB->id, $submission->workspace_id);
        $this->assertNotSame($workspaceA->id, $submission->workspace_id);

        $aQueue = CurrentWorkspace::use($workspaceA->id, fn () => FormSubmission::query()->count());
        $bQueue = CurrentWorkspace::use($workspaceB->id, fn () => FormSubmission::query()->count());
        $this->assertSame(0, $aQueue);
        $this->assertSame(1, $bQueue);
    }

    // ------------------------------------------------------------------
    // 4. Forged project/workspace/form fields in the payload are ignored.
    // ------------------------------------------------------------------
    public function test_forged_identifiers_in_the_payload_are_ignored(): void
    {
        $form = $this->makeForm(1);
        $decoyClient = Client::query()->create(['name' => 'Decoy']);
        $decoyProject = Project::query()->create(['client_id' => $decoyClient->id, 'name' => 'Decoy project']);

        $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'project_id' => $decoyProject->id,
            'workspace_id' => 999999,
            'form_id' => 999999,
            'answers' => [
                'fl1' => 'Legit report',
                'project_id' => $decoyProject->id,
                'workspace_id' => 999999,
            ],
        ])->assertCreated();

        $submission = FormSubmission::query()->where('project_form_id', $form->id)->firstOrFail();
        $this->assertSame($form->project_id, $submission->project_id);
        $this->assertNotSame($decoyProject->id, $submission->project_id);
        $this->assertArrayNotHasKey('project_id', $submission->answers);
    }

    // ------------------------------------------------------------------
    // 5. Every closed reason renders the identical 200 body.
    // ------------------------------------------------------------------
    public function test_paused_expired_archived_and_feature_off_all_render_the_identical_closed_body(): void
    {
        $pausedForm = $this->makeForm(1, ['state' => 'paused']);
        $expiredForm = $this->makeForm(1, ['closes_on' => now()->subDays(3)->toDateString()]);

        $archivedForm = $this->makeForm(1);
        Project::query()->whereKey($archivedForm->project_id)->update(['archived_at' => now()]);

        $featureOffWorkspace = WorkspaceProvisioner::provision(User::factory()->create(), 'Feature off studio');
        $featureOffForm = $this->makeForm($featureOffWorkspace->id);
        Workspace::query()->whereKey($featureOffWorkspace->id)->update(['feature_projects_enabled' => false]);

        $bodies = [];
        foreach (['paused' => $pausedForm, 'expired' => $expiredForm, 'archived' => $archivedForm, 'feature_off' => $featureOffForm] as $label => $form) {
            $response = $this->getJson("/api/public/forms/{$form->slug}")->assertOk();
            $this->assertTrue($response->json('closed'));
            $this->assertSame([], $response->json('fields'));
            $this->assertNotEmpty($response->json('closed_message'));
            $bodies[$label] = $response->json('closed_message');
        }

        $this->assertCount(1, array_unique($bodies), 'every closed reason must render the identical message: '.json_encode($bodies));

        // Same identical message, but 422, on the submission side.
        $post = $this->postJson("/api/public/forms/{$pausedForm->slug}/submissions", ['answers' => ['fl1' => 'x']])
            ->assertStatus(422);
        $this->assertSame(reset($bodies), $post->json('message'));
    }

    // ------------------------------------------------------------------
    // 6. Unknown slug 404s; a malformed slug 404s at the route, no query.
    // ------------------------------------------------------------------
    public function test_unknown_slug_404s_and_a_malformed_slug_404s_with_no_database_query(): void
    {
        $this->getJson('/api/public/forms/'.Str::random(32))->assertNotFound();

        DB::enableQueryLog();
        DB::flushQueryLog();
        $this->getJson('/api/public/forms/nope')->assertNotFound();
        $this->assertSame([], DB::getQueryLog(), 'a malformed slug must 404 at the router, before any query runs');
        DB::disableQueryLog();
    }

    // ------------------------------------------------------------------
    // 7. Disguised files are rejected and nothing reaches disk.
    // ------------------------------------------------------------------
    public function test_disguised_files_are_rejected_and_never_reach_disk(): void
    {
        $form = $this->makeForm(1);

        // A .php file renamed to .png: whatever detects its actual content
        // (finfo, in production) reports its real, non-image type — here
        // simulated the same way TaskAttachmentApiTest already does,
        // through UploadedFile::fake()'s explicit mime override, which is
        // exactly the value our code reads via $file->getMimeType().
        $phpAsPng = UploadedFile::fake()->create('exploit.png', 5, 'text/x-php');
        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Attachment attempt one'],
            'files' => ['fl3' => [$phpAsPng]],
        ])->assertStatus(422);

        // Genuine PNG content named .php: Laravel's own mimes/mimetypes
        // rules block this on the client-declared .php extension before
        // ever trusting the (correctly detected) image content.
        $pngAsPhp = UploadedFile::fake()->create('shell.php', 5, 'image/png');
        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Attachment attempt two'],
            'files' => ['fl3' => [$pngAsPhp]],
        ])->assertStatus(422);

        $this->assertSame(0, FormSubmissionFile::query()->count());
        Storage::disk('local')->assertDirectoryEmpty('form-submissions');
    }

    // ------------------------------------------------------------------
    // 8. File count and size caps (per field); files rejected on a field
    //    that is not a file field, and on a form with no file field at all.
    // ------------------------------------------------------------------
    public function test_file_count_and_size_caps_and_files_without_a_file_field_are_rejected(): void
    {
        $form = $this->makeForm(1);

        $fourFiles = array_map(fn ($i) => UploadedFile::fake()->create("shot{$i}.png", 5, 'image/png'), range(1, 4));
        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Too many files'],
            'files' => ['fl3' => $fourFiles],
        ])->assertStatus(422);

        $tooBig = UploadedFile::fake()->create('huge.png', 11 * 1024, 'image/png');
        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'One huge file'],
            'files' => ['fl3' => [$tooBig]],
        ])->assertStatus(422);

        // fl1 is a short_text field, not a file field.
        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Wrong field id'],
            'files' => ['fl1' => [UploadedFile::fake()->create('shot.png', 5, 'image/png')]],
        ])->assertStatus(422);

        $noFileFieldForm = $this->makeForm(1, [], [
            ['id' => 'fl1', 'type' => 'short_text', 'label' => 'What happened?', 'help' => null, 'required' => true, 'choices' => [], 'maps' => 'title', 'min' => null, 'max' => null],
        ]);
        $this->post("/api/public/forms/{$noFileFieldForm->slug}/submissions", [
            'answers' => ['fl1' => 'No file field here'],
            'files' => ['fl1' => [UploadedFile::fake()->create('shot.png', 5, 'image/png')]],
        ])->assertStatus(422);

        $this->assertSame(0, FormSubmissionFile::query()->count());
    }

    // ------------------------------------------------------------------
    // 9. Files download only through the authenticated nested route.
    // ------------------------------------------------------------------
    public function test_stored_files_download_only_through_the_authenticated_route_with_safe_headers(): void
    {
        $workspace = WorkspaceProvisioner::provision($owner = User::factory()->create(), 'File download studio');
        $form = $this->makeForm($workspace->id);

        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Has a screenshot'],
            'files' => ['fl3' => [UploadedFile::fake()->create('shot.png', 5, 'image/png')]],
        ])->assertCreated();

        $submission = CurrentWorkspace::use($workspace->id, fn () => FormSubmission::query()->where('project_form_id', $form->id)->firstOrFail());
        $file = FormSubmissionFile::query()->where('form_submission_id', $submission->id)->firstOrFail();
        $this->assertSame('fl3', $file->field_id);

        $this->getJson("/api/form-submissions/{$submission->id}/files/{$file->id}")->assertStatus(401);

        Sanctum::actingAs($owner->fresh());
        $download = $this->get("/api/form-submissions/{$submission->id}/files/{$file->id}");
        $download->assertOk();
        $this->assertSame('nosniff', $download->headers->get('x-content-type-options'));
        $this->assertSame("default-src 'none'; sandbox", $download->headers->get('content-security-policy'));

        $otherWorkspace = WorkspaceProvisioner::provision(User::factory()->create(), 'Unrelated studio');
        $otherForm = $this->makeForm($otherWorkspace->id);
        CurrentWorkspace::use($otherWorkspace->id, function () use ($otherForm) {
            FormSubmission::factory()->create([
                'project_form_id' => $otherForm->id,
                'project_id' => $otherForm->project_id,
                'form_snapshot' => $otherForm->toSnapshot(),
            ]);
        });
        $otherSubmission = CurrentWorkspace::use($otherWorkspace->id, fn () => FormSubmission::query()->where('project_form_id', $otherForm->id)->firstOrFail());

        $this->getJson("/api/form-submissions/{$otherSubmission->id}/files/{$file->id}")->assertNotFound();
    }

    // ------------------------------------------------------------------
    // 10. The 6th POST in a minute is throttled, as JSON.
    // ------------------------------------------------------------------
    public function test_the_sixth_post_in_a_minute_is_throttled_as_json(): void
    {
        $form = $this->makeForm(1);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson("/api/public/forms/{$form->slug}/submissions", [
                'answers' => ['fl1' => "Report number {$i}"],
            ])->assertCreated();
        }

        $sixth = $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Report number 6'],
        ]);
        $sixth->assertStatus(429);
        $this->assertJson($sixth->getContent());
        $this->assertStringContainsString('application/json', (string) $sixth->headers->get('content-type'));
    }

    // ------------------------------------------------------------------
    // 11. A submission never reaches /api/tasks unless auto_convert is on.
    // ------------------------------------------------------------------
    public function test_a_submission_only_reaches_tasks_when_auto_convert_is_on(): void
    {
        $manualForm = $this->makeForm(1, ['auto_convert' => false]);
        $this->postJson("/api/public/forms/{$manualForm->slug}/submissions", [
            'answers' => ['fl1' => 'Manual review report'],
        ])->assertCreated();
        $manualSubmission = FormSubmission::query()->where('project_form_id', $manualForm->id)->firstOrFail();
        $this->assertSame('new', $manualSubmission->status);
        $this->assertSame(0, Task::query()->where('form_submission_id', $manualSubmission->id)->count());

        $autoForm = $this->makeForm(1, ['auto_convert' => true]);
        $this->postJson("/api/public/forms/{$autoForm->slug}/submissions", [
            'answers' => ['fl1' => 'Auto converted report'],
        ])->assertCreated();
        $autoSubmission = FormSubmission::query()->where('project_form_id', $autoForm->id)->firstOrFail();
        $this->assertSame('converted', $autoSubmission->status);
        $this->assertSame(1, Task::query()->where('form_submission_id', $autoSubmission->id)->count());
    }

    // ------------------------------------------------------------------
    // 12. Auto-convert throwing still leaves the submission stored as "new".
    // ------------------------------------------------------------------
    public function test_auto_convert_throwing_still_leaves_the_submission_stored_as_new(): void
    {
        $this->app->bind(FormSubmissionConverter::class, fn () => new class extends FormSubmissionConverter
        {
            public function convert(FormSubmission $submission, ?User $actor): Task
            {
                throw new RuntimeException('conversion boom');
            }
        });

        $form = $this->makeForm(1, ['auto_convert' => true]);

        $response = $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'This must survive a converter crash'],
        ]);
        $response->assertCreated();

        $submission = FormSubmission::query()->where('project_form_id', $form->id)->firstOrFail();
        $this->assertSame('new', $submission->status);
        $this->assertNull($submission->task_id);
    }

    // ------------------------------------------------------------------
    // 13. Aggregate submission cap: under every per-field cap, over the total.
    // ------------------------------------------------------------------
    public function test_aggregate_file_cap_rejects_a_submission_under_every_per_field_cap_but_over_the_submission_total(): void
    {
        $manyFileFields = [
            ['id' => 'fl1', 'type' => 'short_text', 'label' => 'What happened?', 'help' => null, 'required' => true, 'choices' => [], 'maps' => 'title', 'min' => null, 'max' => null],
            ['id' => 'fl2', 'type' => 'file', 'label' => 'A', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'none', 'min' => null, 'max' => 3],
            ['id' => 'fl3', 'type' => 'file', 'label' => 'B', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'none', 'min' => null, 'max' => 3],
            ['id' => 'fl4', 'type' => 'file', 'label' => 'C', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'none', 'min' => null, 'max' => 3],
            ['id' => 'fl5', 'type' => 'file', 'label' => 'D', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'none', 'min' => null, 'max' => 3],
        ];
        $form = $this->makeForm(1, [], $manyFileFields);

        // 4 fields x 3 files each = 12 files. Every field is at, not over,
        // its own per-field cap of 3 (FormSubmissionFileStorage::MAX_FILES) —
        // only the aggregate 10-file ceiling across the whole submission is
        // violated.
        $this->assertSame(3, FormSubmissionFileStorage::MAX_FILES);
        $this->assertSame(10, FormSubmissionFileStorage::MAX_TOTAL_FILES);

        $threeSmallFiles = fn (string $prefix) => array_map(
            fn ($i) => UploadedFile::fake()->create("{$prefix}{$i}.png", 5, 'image/png'),
            range(1, 3),
        );

        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Twelve small files across four fields'],
            'files' => [
                'fl2' => $threeSmallFiles('a'),
                'fl3' => $threeSmallFiles('b'),
                'fl4' => $threeSmallFiles('c'),
                'fl5' => $threeSmallFiles('d'),
            ],
        ])->assertStatus(422)
            ->assertJson(['message' => PublicFormAvailability::MESSAGE]);

        $this->assertSame(0, FormSubmission::query()->count());
        $this->assertSame(0, FormSubmissionFile::query()->count());
    }

    // ------------------------------------------------------------------
    // 14. Daily per-form cap: the check-then-insert is atomic within one
    //     transaction, not a read-then-write race. True concurrent requests
    //     cannot be produced against the in-memory sqlite test database (a
    //     second connection is a second, empty database), so this proves
    //     the mechanism directly: the form row is locked and the count is
    //     re-read INSIDE the same transaction as the insert, and no
    //     submission is ever created once the cap check fails.
    // ------------------------------------------------------------------
    public function test_daily_form_cap_check_and_insert_happen_inside_one_locked_transaction(): void
    {
        $form = $this->makeForm(1);

        FormSubmission::factory()->count(200)->create([
            'project_form_id' => $form->id,
            'project_id' => $form->project_id,
            'form_snapshot' => $form->toSnapshot(),
            'created_at' => now(),
        ]);

        DB::enableQueryLog();
        DB::flushQueryLog();

        $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'The 201st report'],
        ])->assertStatus(422)->assertJson(['message' => PublicFormAvailability::MESSAGE]);

        $log = DB::getQueryLog();
        DB::disableQueryLog();

        // The form row is read (and, on a real transactional driver, locked)
        // before the cap-violating count is even taken, and no INSERT into
        // form_submissions ever runs — the reject happens strictly before
        // any write, inside the same transaction as that read, which is
        // exactly what closes the read-then-write race a lock-free
        // count-then-compare left open.
        $sawFormLock = false;
        $sawCountQuery = false;
        foreach ($log as $entry) {
            $sql = strtolower($entry['query']);
            if (str_contains($sql, 'from "project_forms"') || str_contains($sql, 'from `project_forms`')) {
                $sawFormLock = true;
            }
            if (str_contains($sql, 'select count') && str_contains($sql, 'form_submissions')) {
                $sawCountQuery = true;
                $this->assertFalse($sawFormLock === false, 'the form row must be read before the count is taken');
            }
            $this->assertStringNotContainsString('insert into "form_submissions"', $sql);
        }
        $this->assertTrue($sawFormLock, 'expected a locking read against project_forms');
        $this->assertTrue($sawCountQuery, 'expected the recount against form_submissions');

        $this->assertSame(200, FormSubmission::query()->where('project_form_id', $form->id)->count());
    }

    // ------------------------------------------------------------------
    // 15. Per-email daily cap applies even when require_email is false.
    // ------------------------------------------------------------------
    public function test_per_email_daily_cap_applies_when_require_email_is_false(): void
    {
        // The per-minute submission throttle (5/min, see AppServiceProvider)
        // is a separate concern from the per-email daily cap this test is
        // isolating; disabled here so 11 requests can be made without
        // tripping it first.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);

        $form = $this->makeForm(1, ['require_email' => false]);

        for ($i = 0; $i < 10; $i++) {
            $this->postJson("/api/public/forms/{$form->slug}/submissions", [
                'answers' => ['fl1' => "Report {$i}"],
                'from_email' => 'repeat@example.com',
            ])->assertCreated();
        }

        $eleventh = $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Report 11'],
            'from_email' => 'repeat@example.com',
        ]);
        $eleventh->assertStatus(422);
        $this->assertSame(PublicFormAvailability::MESSAGE, $eleventh->json('message'));

        $this->assertSame(10, FormSubmission::query()->where('project_form_id', $form->id)->count());
    }

    // ------------------------------------------------------------------
    // 16. A failed disk write rolls the whole submission back.
    // ------------------------------------------------------------------
    public function test_a_failed_disk_write_rolls_back_the_submission_instead_of_committing_an_empty_storage_path(): void
    {
        $form = $this->makeForm(1);

        $failingDisk = Mockery::mock(Filesystem::class);
        $failingDisk->shouldReceive('putFileAs')->andReturn(false);
        Storage::shouldReceive('disk')->with(FormSubmissionFileStorage::DISK)->andReturn($failingDisk);

        $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Disk is full'],
            'files' => ['fl3' => [UploadedFile::fake()->create('shot.png', 5, 'image/png')]],
        ])->assertStatus(500);

        $this->assertSame(0, FormSubmission::query()->count());
        $this->assertSame(0, FormSubmissionFile::query()->count());
    }

    // ------------------------------------------------------------------
    // 17. Staff-side reads never expose ip_hash / user_agent.
    // ------------------------------------------------------------------
    public function test_staff_side_submission_reads_never_expose_ip_hash_or_user_agent(): void
    {
        $workspace = WorkspaceProvisioner::provision($owner = User::factory()->create(), 'PII hiding studio');
        $form = $this->makeForm($workspace->id);

        $this->postJson("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Has an IP and a user agent'],
        ])->assertCreated();

        $submission = CurrentWorkspace::use($workspace->id, fn () => FormSubmission::query()->where('project_form_id', $form->id)->firstOrFail());
        $this->assertNotNull($submission->ip_hash);

        Sanctum::actingAs($owner->fresh());

        $index = $this->getJson("/api/project-forms/{$form->id}/submissions")->assertOk();
        $indexRaw = $index->getContent();
        $this->assertStringNotContainsString('ip_hash', $indexRaw);
        $this->assertStringNotContainsString('user_agent', $indexRaw);

        $show = $this->getJson("/api/form-submissions/{$submission->id}")->assertOk();
        $showRaw = $show->getContent();
        $this->assertStringNotContainsString('ip_hash', $showRaw);
        $this->assertStringNotContainsString('user_agent', $showRaw);
    }

    // ------------------------------------------------------------------
    // 18. Headers attach even on a 404 (unknown slug) and a 429 (throttled).
    // ------------------------------------------------------------------
    public function test_security_headers_attach_to_a_404_and_a_429(): void
    {
        $notFound = $this->getJson('/api/public/forms/'.Str::random(32));
        $notFound->assertNotFound();
        $notFound->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Robots-Tag', 'noindex, nofollow')
            ->assertHeader('Referrer-Policy', 'no-referrer');

        $form = $this->makeForm(1);
        for ($i = 0; $i < 60; $i++) {
            $this->getJson("/api/public/forms/{$form->slug}");
        }
        $throttled = $this->getJson("/api/public/forms/{$form->slug}");
        $throttled->assertStatus(429);
        $throttled->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Robots-Tag', 'noindex, nofollow')
            ->assertHeader('Referrer-Policy', 'no-referrer');
    }

    // ------------------------------------------------------------------
    // 19. A nested files[] structure 422s cleanly instead of 500ing.
    // ------------------------------------------------------------------
    public function test_a_nested_files_structure_is_rejected_with_a_clean_422_not_a_500(): void
    {
        $form = $this->makeForm(1);

        $response = $this->post("/api/public/forms/{$form->slug}/submissions", [
            'answers' => ['fl1' => 'Nested files probe'],
            'files' => ['fl3' => ['a' => ['b' => UploadedFile::fake()->create('shot.png', 5, 'image/png')]]],
        ]);

        $response->assertStatus(422);
        $this->assertSame(0, FormSubmissionFile::query()->count());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * @param  array<string, mixed>  $overrides
     * @param  array<int, array<string, mixed>>|null  $fields
     */
    private function makeForm(int $workspaceId, array $overrides = [], ?array $fields = null): ProjectForm
    {
        return CurrentWorkspace::use($workspaceId, function () use ($overrides, $fields) {
            $client = Client::query()->create(['name' => 'Acme Co']);
            $project = Project::query()->create(['client_id' => $client->id, 'name' => 'Acme website']);

            $defaultFields = [
                ['id' => 'fl1', 'type' => 'short_text', 'label' => 'What happened?', 'help' => null, 'required' => true, 'choices' => [], 'maps' => 'title', 'min' => null, 'max' => null],
                [
                    'id' => 'fl2', 'type' => 'severity', 'label' => 'How bad is it?', 'help' => null, 'required' => false,
                    'choices' => [
                        ['value' => 'blocking', 'label' => 'Blocking', 'caption' => null, 'urgency_key' => 'urgent'],
                        ['value' => 'minor', 'label' => 'Minor', 'caption' => null, 'urgency_key' => 'low'],
                    ],
                    'maps' => 'urgency', 'min' => null, 'max' => null,
                ],
                ['id' => 'fl3', 'type' => 'file', 'label' => 'Attachment', 'help' => null, 'required' => false, 'choices' => [], 'maps' => 'none', 'min' => null, 'max' => 3],
            ];

            return ProjectForm::query()->create(array_merge([
                'project_id' => $project->id,
                'title' => 'Bug Report',
                'blurb' => 'Tell us what broke',
                'header_line' => 'Acme Co',
                'icon' => null,
                'slug' => Str::random(32),
                'state' => 'live',
                'fields' => $fields ?? $defaultFields,
                'next_field_seq' => 4,
                'require_email' => false,
                'auto_convert' => false,
                'notify' => true,
                'task_type_key' => null,
                'closes_on' => null,
            ], $overrides));
        });
    }

}
