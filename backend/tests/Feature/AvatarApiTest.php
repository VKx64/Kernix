<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\AvatarStorage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AvatarApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
    }

    public function test_it_stores_a_picture_and_reports_a_url_the_client_can_render(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->post('/api/profile/avatar', [
            'avatar' => UploadedFile::fake()->image('me.jpg', 900, 600),
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.id', $this->admin->id);

        $stored = $this->admin->fresh()->getRawOriginal('profile_image');
        $this->assertStringStartsWith("avatars/{$this->admin->id}/", $stored);
        $this->assertStringEndsWith('.webp', $stored);
        Storage::disk('local')->assertExists($stored);

        // The API hands back a route, never the private storage path.
        $this->assertStringContainsString("/api/users/{$this->admin->id}/avatar", $response->json('data.profile_image'));
        $this->assertStringNotContainsString('avatars/', $response->json('data.profile_image'));
    }

    public function test_it_crops_to_a_square_so_avatars_are_never_distorted(): void
    {
        Sanctum::actingAs($this->admin);

        $this->post('/api/profile/avatar', [
            'avatar' => UploadedFile::fake()->image('wide.png', 1200, 400),
        ])->assertOk();

        $path = $this->admin->fresh()->getRawOriginal('profile_image');
        $image = imagecreatefromstring(Storage::disk('local')->get($path));

        $this->assertSame(AvatarStorage::EDGE, imagesx($image));
        $this->assertSame(AvatarStorage::EDGE, imagesy($image));
    }

    public function test_it_refuses_a_file_that_is_not_an_image(): void
    {
        Sanctum::actingAs($this->admin);

        $this->post('/api/profile/avatar', [
            'avatar' => UploadedFile::fake()->create('payload.php', 12, 'text/plain'),
        ])->assertStatus(422);

        $this->assertNull($this->admin->fresh()->getRawOriginal('profile_image'));
    }

    public function test_replacing_a_picture_removes_the_previous_file(): void
    {
        Sanctum::actingAs($this->admin);

        $this->post('/api/profile/avatar', ['avatar' => UploadedFile::fake()->image('first.jpg')])->assertOk();
        $first = $this->admin->fresh()->getRawOriginal('profile_image');

        $this->post('/api/profile/avatar', ['avatar' => UploadedFile::fake()->image('second.jpg')])->assertOk();
        $second = $this->admin->fresh()->getRawOriginal('profile_image');

        $this->assertNotSame($first, $second);
        Storage::disk('local')->assertMissing($first);
        Storage::disk('local')->assertExists($second);
    }

    public function test_removing_a_picture_clears_the_column_and_the_file(): void
    {
        Sanctum::actingAs($this->admin);

        $this->post('/api/profile/avatar', ['avatar' => UploadedFile::fake()->image('me.jpg')])->assertOk();
        $path = $this->admin->fresh()->getRawOriginal('profile_image');

        $this->delete('/api/profile/avatar')->assertOk();

        $this->assertNull($this->admin->fresh()->getRawOriginal('profile_image'));
        Storage::disk('local')->assertMissing($path);
    }

    public function test_the_file_is_served_only_to_a_signed_in_viewer(): void
    {
        Sanctum::actingAs($this->admin);
        $this->post('/api/profile/avatar', ['avatar' => UploadedFile::fake()->image('me.jpg')])->assertOk();

        $this->get("/api/users/{$this->admin->id}/avatar")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp')
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        app('auth')->forgetGuards();
        $this->getJson("/api/users/{$this->admin->id}/avatar")->assertStatus(401);
    }

    public function test_setting_someone_elses_picture_requires_users_edit(): void
    {
        $target = $this->member();
        $other = $this->member('bystander');
        Sanctum::actingAs($other);

        $this->post("/api/users/{$target->id}/avatar", [
            'avatar' => UploadedFile::fake()->image('not-mine.jpg'),
        ])->assertStatus(403);

        $this->assertNull($target->fresh()->getRawOriginal('profile_image'));
    }

    public function test_a_user_manager_may_set_a_picture_for_someone_else(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->admin);

        $this->post("/api/users/{$target->id}/avatar", [
            'avatar' => UploadedFile::fake()->image('staff.jpg'),
        ])->assertOk();

        $this->assertNotNull($target->fresh()->getRawOriginal('profile_image'));
    }

    public function test_the_profile_endpoint_no_longer_accepts_a_raw_image_path(): void
    {
        Sanctum::actingAs($this->admin);

        $this->patchJson('/api/profile', ['profile_image' => 'avatars/9/someone-elses.webp'])->assertOk();

        $this->assertNull($this->admin->fresh()->getRawOriginal('profile_image'));
    }

    /**
     * A role of its own with nothing granted, so the authorization assertions
     * do not quietly depend on what the seeded roles happen to include.
     */
    private function member(string $username = 'colleague'): User
    {
        $role = Role::query()->create([
            'key_name' => "{$username}-role",
            'name' => ucfirst($username),
            'sort_order' => 99,
        ]);

        return User::query()->create([
            'username' => $username,
            'first_name' => 'Casey',
            'last_name' => 'Member',
            'password_hash' => bcrypt('password-for-testing'),
            'role_id' => $role->id,
            'status' => 'active',
        ]);
    }
}
