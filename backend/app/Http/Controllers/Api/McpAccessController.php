<?php

namespace App\Http\Controllers\Api;

use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Tokens that let an AI assistant act as its holder through the MCP server.
 *
 * Deliberately personal rather than shared: the token carries whoever minted
 * it, so the assistant inherits exactly that person's role, permissions and
 * workspace. An owner's assistant sees the portfolio; an employee's assistant
 * sees their own work. Nobody gains reach by pointing an assistant at Kernix.
 *
 * The plaintext token is shown once, at creation, and only its hash is stored —
 * the same contract as the browser extension pairing flow.
 */
class McpAccessController extends ApiController
{
    /**
     * Marks the tokens this screen owns, so revoking one here can never reach a
     * browser-extension token or a session cookie.
     */
    private const LABEL = 'AI assistant · ';

    public function index(Request $request): JsonResponse
    {
        $workspace = Workspace::query()->find(CurrentWorkspace::id());

        return $this->data([
            // The MCP server is one deployment serving every workspace; which
            // workspace a connection lands in is decided by the token, not by
            // the URL. The client still needs to be told where to point.
            'endpoint' => rtrim((string) config('services.mcp.url'), '/') ?: null,
            'local_endpoint' => 'http://127.0.0.1:8765/mcp',
            'workspace' => $workspace ? ['id' => $workspace->id, 'name' => $workspace->name] : null,
            'tokens' => $this->tokens($request),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            'expires_in_days' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:365'],
        ]);

        $label = Str::limit(Str::squish(strip_tags($data['name'])), 60, '');
        abort_if($label === '', 422, 'Give the connection a name you will recognise later.');

        $expiresAt = isset($data['expires_in_days'])
            ? now()->addDays((int) $data['expires_in_days'])
            : null;

        // `web-api` is what the main API checks for; an extension token
        // deliberately cannot reach these routes.
        $token = $request->user()->createToken(self::LABEL.$label, ['web-api'], $expiresAt);

        $this->audit($request, 'mcp.token.create', $token->accessToken, [
            'name' => $label,
            'expires_at' => $expiresAt,
        ]);

        return $this->data([
            // The only time the plaintext exists outside the client's hands.
            'token' => $token->plainTextToken,
            'connection' => $this->present($token->accessToken),
        ], 201);
    }

    /**
     * Approve a connector that cannot be handed a token directly.
     *
     * ChatGPT's connectors offer OAuth or nothing — there is no field to paste
     * a token into — so the MCP server runs the authorization flow and sends
     * the person here to sign in and say yes. This is the moment they say it.
     *
     * The token is not returned. It is held against a one-time handoff that the
     * MCP server spends from its own side, which keeps the token out of the
     * browser's address bar and out of anything that logs URLs.
     */
    public function authorize(Request $request): JsonResponse
    {
        $data = $request->validate([
            'client' => ['required', 'string', 'max:60'],
        ]);

        $label = Str::limit(Str::squish(strip_tags($data['client'])), 60, '') ?: 'AI assistant';
        $token = $request->user()->createToken(self::LABEL.$label, ['web-api']);

        $this->audit($request, 'mcp.token.create', $token->accessToken, [
            'name' => $label,
            'via' => 'oauth',
        ]);

        $handoff = bin2hex(random_bytes(32));
        // Long enough to survive a redirect, short enough that a value left in
        // a browser's history is worth nothing by the time anyone finds it.
        Cache::put(self::handoffKey($handoff), $token->plainTextToken, now()->addSeconds(120));

        return $this->data([
            'handoff' => $handoff,
            'connection' => $this->present($token->accessToken),
        ], 201);
    }

    /**
     * Spend a handoff for the token it stands for.
     *
     * Called by the MCP server rather than a browser, and unauthenticated by
     * necessity — the caller has no session, only the handoff. What protects it
     * is that the handoff is 64 random hex characters, lives two minutes, and
     * is gone the moment it is read.
     */
    public function claim(Request $request): JsonResponse
    {
        $data = $request->validate([
            'handoff' => ['required', 'string', 'size:64', 'regex:/^[a-f0-9]+$/'],
        ]);

        $token = Cache::pull(self::handoffKey($data['handoff']));
        abort_if($token === null, 404, 'That approval has already been used, or it expired. Start again from the connector.');

        return $this->data(['token' => $token]);
    }

    private static function handoffKey(string $handoff): string
    {
        return 'mcp.oauth.handoff.'.$handoff;
    }

    public function destroy(Request $request, int $token): JsonResponse
    {
        $model = $request->user()->tokens()
            ->whereKey($token)
            ->where('name', 'like', self::LABEL.'%')
            ->firstOrFail();

        $this->audit($request, 'mcp.token.revoke', $model, ['name' => $model->name]);
        $model->delete();

        return $this->data(['revoked' => true]);
    }

    /** @return array<int, array<string, mixed>> */
    private function tokens(Request $request): array
    {
        return $request->user()->tokens()
            ->where('name', 'like', self::LABEL.'%')
            ->latest()
            ->get()
            ->map(fn ($token) => $this->present($token))
            ->all();
    }

    /** @return array<string, mixed> */
    private function present(mixed $token): array
    {
        return [
            'id' => $token->id,
            'name' => Str::after($token->name, self::LABEL),
            'created_at' => $token->created_at,
            'last_used_at' => $token->last_used_at,
            'expires_at' => $token->expires_at,
        ];
    }
}
