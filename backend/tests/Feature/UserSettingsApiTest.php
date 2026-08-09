<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserSetting;
use App\Support\UserSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Personal preferences: every signed-in person may read and write their own set
 * and nobody else's. The store is deliberately forgiving about numbers and
 * strict about names, so the tests below pin both halves of that.
 */
class UserSettingsApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private User $other;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->user = User::query()->findOrFail(1);
        $this->other = User::factory()->create(['first_name' => 'Liam', 'last_name' => 'Cruz']);

        Sanctum::actingAs($this->user);
    }

    public function test_a_person_who_has_never_saved_gets_the_whole_default_set(): void
    {
        $response = $this->getJson('/api/me/settings')->assertOk();

        $this->assertSame(UserSettings::keys(), array_keys($response->json('data')));
        $response->assertJsonPath('data.daily_target_minutes', 420)
            ->assertJsonPath('data.weekly_target_minutes', 2100)
            ->assertJsonPath('data.timesheet_cutoff', 'semi')
            ->assertJsonPath('data.timesheet_date_format', 'short')
            ->assertJsonPath('data.timesheet_header_row', false)
            ->assertJsonPath('data.row_density', 'comfortable')
            ->assertJsonPath('data.auto_start_timer', false)
            ->assertJsonPath('data.start_page', 'dashboard')
            ->assertJsonPath('data.notify_in_app', true)
            ->assertJsonPath('data.notify_email', false)
            ->assertJsonPath('data.daily_digest', 'off')
            ->assertJsonPath('data.idle_detection', false);

        $this->assertDatabaseCount('user_settings', 0);
    }

    public function test_settings_need_a_signed_in_person(): void
    {
        app('auth')->forgetGuards();

        $this->getJson('/api/me/settings')->assertUnauthorized();
        $this->patchJson('/api/me/settings', ['row_density' => 'compact'])->assertUnauthorized();
    }

    public function test_a_partial_patch_merges_over_what_is_stored(): void
    {
        $this->patchJson('/api/me/settings', ['row_density' => 'compact', 'auto_start_timer' => true])
            ->assertOk()
            ->assertJsonPath('data.row_density', 'compact')
            ->assertJsonPath('data.auto_start_timer', true);

        $this->patchJson('/api/me/settings', ['start_page' => 'oliver'])
            ->assertOk()
            // The whole merged set comes back, not only what was sent.
            ->assertJsonPath('data.start_page', 'oliver')
            ->assertJsonPath('data.row_density', 'compact')
            ->assertJsonPath('data.auto_start_timer', true)
            ->assertJsonPath('data.daily_target_minutes', 420);

        $this->getJson('/api/me/settings')
            ->assertOk()
            ->assertJsonPath('data.row_density', 'compact')
            ->assertJsonPath('data.start_page', 'oliver');

        // One row per person, however many times they save.
        $this->assertDatabaseCount('user_settings', 1);
    }

    public function test_an_unknown_key_is_rejected_by_name(): void
    {
        $this->patchJson('/api/me/settings', ['favourite_colour' => 'green', 'row_density' => 'compact'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('favourite_colour')
            ->assertJsonPath('errors.favourite_colour.0', 'Unknown setting "favourite_colour".');

        $this->assertDatabaseCount('user_settings', 0);
    }

    public function test_a_number_out_of_range_clamps_at_both_ends(): void
    {
        $this->patchJson('/api/me/settings', ['daily_target_minutes' => 5, 'weekly_target_minutes' => 10])
            ->assertOk()
            ->assertJsonPath('data.daily_target_minutes', 60)
            ->assertJsonPath('data.weekly_target_minutes', 300);

        $this->patchJson('/api/me/settings', ['daily_target_minutes' => 99999, 'weekly_target_minutes' => 99999])
            ->assertOk()
            ->assertJsonPath('data.daily_target_minutes', 720)
            ->assertJsonPath('data.weekly_target_minutes', 3600);
    }

    public function test_an_invalid_enum_or_type_is_rejected(): void
    {
        $this->patchJson('/api/me/settings', ['start_page' => 'timesheet'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('start_page');

        $this->patchJson('/api/me/settings', ['timesheet_cutoff' => 'weekly'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('timesheet_cutoff');

        $this->patchJson('/api/me/settings', ['daily_target_minutes' => 'seven hours'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('daily_target_minutes');

        $this->patchJson('/api/me/settings', ['auto_start_timer' => 'maybe'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('auto_start_timer');

        $this->assertDatabaseCount('user_settings', 0);
    }

    public function test_one_person_never_sees_or_touches_anothers_settings(): void
    {
        $this->patchJson('/api/me/settings', ['row_density' => 'compact', 'daily_target_minutes' => 300])
            ->assertOk();

        Sanctum::actingAs($this->other);

        // The other person still gets defaults, not the first person's choices.
        $this->getJson('/api/me/settings')
            ->assertOk()
            ->assertJsonPath('data.row_density', 'comfortable')
            ->assertJsonPath('data.daily_target_minutes', 420);

        $this->patchJson('/api/me/settings', ['row_density' => 'compact', 'daily_target_minutes' => 480])
            ->assertOk()
            ->assertJsonPath('data.daily_target_minutes', 480);

        // Writing their own left the first person's row alone.
        $mine = UserSetting::query()->where('user_id', $this->user->id)->firstOrFail();
        $this->assertSame(300, $mine->values['daily_target_minutes']);
        $this->assertDatabaseCount('user_settings', 2);
    }

    public function test_the_dashboard_target_and_its_note_follow_the_setting(): void
    {
        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('data.daily_target_minutes', 420)
            ->assertJsonPath('data.metrics.tracked_today.note', 'of 7h target');

        $this->patchJson('/api/me/settings', ['daily_target_minutes' => 360])->assertOk();

        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('data.daily_target_minutes', 360)
            ->assertJsonPath('data.metrics.tracked_today.note', 'of 6h target');
    }

    public function test_olivers_weekly_target_follows_the_setting(): void
    {
        $this->getJson('/api/oliver/insights')
            ->assertOk()
            ->assertJsonPath('data.workload.target_week_minutes', 2100);

        $this->patchJson('/api/me/settings', ['weekly_target_minutes' => 1500])->assertOk();

        $this->getJson('/api/oliver/insights')
            ->assertOk()
            ->assertJsonPath('data.workload.target_week_minutes', 1500);
    }

    public function test_a_stored_value_that_has_gone_bad_falls_back_instead_of_reaching_a_screen(): void
    {
        UserSetting::query()->create([
            'user_id' => $this->user->id,
            'values' => ['daily_target_minutes' => 9000, 'start_page' => 'nowhere', 'auto_start_timer' => 'yes'],
        ]);

        $this->getJson('/api/me/settings')
            ->assertOk()
            ->assertJsonPath('data.daily_target_minutes', 720)
            ->assertJsonPath('data.start_page', 'dashboard')
            ->assertJsonPath('data.auto_start_timer', true);
    }
}
