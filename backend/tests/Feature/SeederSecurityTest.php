<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SeederSecurityTest extends TestCase
{
    use RefreshDatabase;

    #[DataProvider('invalidAdminPasswords')]
    public function test_initial_seed_requires_a_strong_explicit_admin_password(?string $password): void
    {
        config()->set('auth.initial_admin_password', $password);

        try {
            $this->seed();
            $this->fail('The initial seed accepted an unsafe administrator password.');
        } catch (LogicException $exception) {
            $this->assertStringContainsString('Set ADMIN_PASSWORD to at least 12 characters', $exception->getMessage());
        }

        $this->assertDatabaseCount('roles', 0);
        $this->assertDatabaseCount('users', 0);
    }

    public function test_existing_administrator_is_not_changed_when_reseeding_without_a_password(): void
    {
        $this->seed();
        $originalHash = User::query()->findOrFail(1)->password_hash;

        config()->set('auth.initial_admin_password');
        $this->seed();

        $this->assertSame($originalHash, User::query()->findOrFail(1)->password_hash);
    }

    /** @return array<string, array{0: ?string}> */
    public static function invalidAdminPasswords(): array
    {
        return [
            'missing' => [null],
            'too short' => ['short'],
        ];
    }
}
