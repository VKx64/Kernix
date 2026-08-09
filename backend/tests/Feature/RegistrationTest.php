<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Public sign-up, exercised the way the browser actually hits it: JSON over
 * the session-cookie routes in web.php, not the token-based /api guard.
 *
 * The 302-instead-of-422 regression is the point of the failure tests. Those
 * routes render through the framework's own exception handler rather than a
 * controller catch, so it is easy for a global rendering rule to quietly
 * swallow a validation failure behind a redirect a browser fetch would just
 * follow.
 */
class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Kylle Vryann',
            'email' => 'kylle@example.test',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ], $overrides);
    }

    public function test_a_new_account_is_created_and_signed_in(): void
    {
        $response = $this->postJson('/register', $this->payload());

        $response->assertCreated();
        $response->assertJsonPath('data.imagic_email', 'kylle@example.test');
        $response->assertJsonPath('data.needs_workspace', true);

        $this->assertDatabaseHas('users', ['imagic_email' => 'kylle@example.test']);
        $this->assertAuthenticated();
    }

    public function test_a_duplicate_email_reports_a_field_error_as_json(): void
    {
        User::factory()->create(['imagic_email' => 'kylle@example.test']);

        $response = $this->postJson('/register', $this->payload());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['email']);
    }

    public function test_a_short_password_reports_a_field_error_as_json(): void
    {
        $response = $this->postJson('/register', $this->payload([
            'password' => 'short',
            'password_confirmation' => 'short',
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['password']);
    }
}
