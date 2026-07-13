<?php

namespace Tests\Feature;

use App\Models\SystemSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class BackendBrandingTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin, ['web-api']);
    }

    public function test_kernix_is_the_default_brand_presented_by_backend_apis(): void
    {
        $this->assertSame('Kernix', config('app.name'));
        $this->assertSame('Kernix', config('mail.from.name'));
        $this->assertSame('Kernix', SystemSetting::query()->findOrFail(1)->smtp_from_name);

        $this->getJson('/api/settings/context')
            ->assertOk()
            ->assertJsonPath('data.app_name', 'Kernix');

        Sanctum::actingAs($this->admin, ['extension-api']);
        $this->getJson('/api/extension/bootstrap')
            ->assertOk()
            ->assertJsonPath('data.workspace.name', 'Kernix');
    }

    public function test_reseeding_does_not_overwrite_a_custom_email_sender(): void
    {
        $settings = SystemSetting::query()->findOrFail(1);
        $settings->update([
            'smtp_from_name' => 'Custom Operations',
            'smtp_from_email' => 'operations@example.test',
        ]);

        $this->seed();

        $settings->refresh();
        $this->assertSame('Custom Operations', $settings->smtp_from_name);
        $this->assertSame('operations@example.test', $settings->smtp_from_email);
    }
}
