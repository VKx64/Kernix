<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\CurrentWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The half of the assistant sign-in flow that Kernix owns.
 *
 * A connector that cannot hold a pasted token — ChatGPT's is the one that
 * forced this — sends the person here to approve instead. Kernix mints the
 * token at that moment and holds it against a one-time handoff, which the MCP
 * server spends from its own side so the token never rides in a URL.
 */
class McpAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        CurrentWorkspace::reset();
        $this->seed();
        $this->user = User::query()->findOrFail(1);
    }

    public function test_approving_mints_a_token_reachable_only_through_the_handoff(): void
    {
        Sanctum::actingAs($this->user);

        $handoff = $this->postJson('/api/mcp/authorize', ['client' => 'ChatGPT'])
            ->assertCreated()
            ->assertJsonPath('data.connection.name', 'ChatGPT')
            // The token itself must not come back to the browser.
            ->assertJsonMissingPath('data.token')
            ->json('data.handoff');

        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $handoff);

        $token = $this->postJson('/api/mcp/authorize/claim', ['handoff' => $handoff])
            ->assertOk()
            ->json('data.token');

        $this->assertNotEmpty($token);

        // And it is a working token for the account that approved it.
        $this->withToken($token)->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.id', $this->user->id);
    }

    public function test_a_handoff_can_only_be_spent_once(): void
    {
        Sanctum::actingAs($this->user);

        $handoff = $this->postJson('/api/mcp/authorize', ['client' => 'ChatGPT'])
            ->assertCreated()
            ->json('data.handoff');

        $this->postJson('/api/mcp/authorize/claim', ['handoff' => $handoff])->assertOk();
        $this->postJson('/api/mcp/authorize/claim', ['handoff' => $handoff])->assertNotFound();
    }

    public function test_an_expired_handoff_is_worth_nothing(): void
    {
        Sanctum::actingAs($this->user);

        $handoff = $this->postJson('/api/mcp/authorize', ['client' => 'ChatGPT'])
            ->assertCreated()
            ->json('data.handoff');

        $this->travel(3)->minutes();

        $this->postJson('/api/mcp/authorize/claim', ['handoff' => $handoff])->assertNotFound();
    }

    public function test_a_guessed_handoff_is_refused(): void
    {
        $this->postJson('/api/mcp/authorize/claim', ['handoff' => str_repeat('a', 64)])
            ->assertNotFound();

        // Shape is checked before anything is looked up, so a probe cannot use
        // the difference between "wrong shape" and "wrong value" to learn much.
        $this->postJson('/api/mcp/authorize/claim', ['handoff' => 'nope'])
            ->assertStatus(422);
    }

    public function test_approving_requires_being_signed_in(): void
    {
        $this->postJson('/api/mcp/authorize', ['client' => 'ChatGPT'])
            ->assertUnauthorized();

        $this->assertNull(Cache::get('mcp.oauth.handoff.'.str_repeat('a', 64)));
    }

    public function test_the_minted_token_shows_up_as_a_revocable_connection(): void
    {
        Sanctum::actingAs($this->user);

        $this->postJson('/api/mcp/authorize', ['client' => 'ChatGPT'])->assertCreated();

        $connections = $this->getJson('/api/mcp/access')->assertOk()->json('data.tokens');
        $this->assertContains('ChatGPT', array_column($connections, 'name'));

        $id = $connections[0]['id'];
        $this->deleteJson("/api/mcp/access/{$id}")->assertOk();

        $this->assertNotContains(
            'ChatGPT',
            array_column($this->getJson('/api/mcp/access')->json('data.tokens'), 'name'),
        );
    }
}
