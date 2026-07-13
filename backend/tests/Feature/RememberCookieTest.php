<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\TestCase;

class RememberCookieTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_old_remember_cookie_cannot_reauthenticate_after_an_admin_password_reset(): void
    {
        $this->seed();
        $target = User::factory()->create([
            'username' => 'remembered-user',
            'password_hash' => Hash::make('OriginalPassword123!'),
            'remember_token' => null,
        ]);

        $login = $this->postJson('/login', [
            'login' => $target->username,
            'password' => 'OriginalPassword123!',
            'remember' => true,
        ])->assertOk();
        $recallerName = Auth::guard('web')->getRecallerName();
        $recaller = collect($login->headers->getCookies())
            ->first(fn (Cookie $cookie): bool => $cookie->getName() === $recallerName);
        $this->assertNotNull($recaller);
        $oldToken = $target->fresh()->remember_token;
        $this->assertNotEmpty($oldToken);

        $this->flushSession();
        Auth::forgetGuards();
        Auth::shouldUse('web');
        $this->withHeader('Origin', 'http://localhost:5173')
            ->withCredentials()
            ->withUnencryptedCookie($recallerName, $recaller->getValue())
            ->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.id', $target->id);

        $this->defaultCookies = [];
        $this->unencryptedCookies = [];
        $this->withCredentials = false;
        $this->defaultHeaders = [];
        $this->flushSession();
        Auth::forgetGuards();
        $admin = User::query()->findOrFail(1);
        Sanctum::actingAs($admin);
        $this->patchJson("/api/users/{$target->id}", [
            'password' => 'ResetPassword123!',
            'password_confirmation' => 'ResetPassword123!',
        ])->assertOk();
        $this->assertNotSame($oldToken, $target->fresh()->remember_token);

        $this->flushSession();
        Auth::forgetGuards();
        Auth::shouldUse('web');
        $this->withHeader('Origin', 'http://localhost:5173')
            ->withCredentials()
            ->withUnencryptedCookie($recallerName, $recaller->getValue())
            ->getJson('/api/user')
            ->assertUnauthorized();
    }
}
