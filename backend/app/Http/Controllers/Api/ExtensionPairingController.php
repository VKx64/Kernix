<?php

namespace App\Http\Controllers\Api;

use App\Models\ExtensionPairingCode;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ExtensionPairingController extends ApiController
{
    private const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    public function store(Request $request): JsonResponse
    {
        ExtensionPairingCode::query()->where('expires_at', '<', now()->subDay())->delete();
        ExtensionPairingCode::query()
            ->where('user_id', $request->user()->id)
            ->whereNull('redeemed_at')
            ->delete();

        [$plainCode, $normalized] = $this->newCode();
        $pairing = ExtensionPairingCode::create([
            'user_id' => $request->user()->id,
            'code_hash' => $this->hashCode($normalized),
            'expires_at' => now()->addMinutes(10),
        ]);
        $this->audit($request, 'extension.pairing.create', $pairing, [
            'expires_at' => $pairing->expires_at,
        ]);

        return $this->data([
            'code' => $plainCode,
            'expires_at' => $pairing->expires_at,
        ], 201);
    }

    public function exchange(Request $request): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'max:32'],
            'device_name' => ['required', 'string', 'max:80'],
        ]);
        $normalized = $this->normalizeCode($data['code']);
        if (strlen($normalized) !== 10) {
            $this->invalidCode();
        }
        $deviceName = Str::limit(Str::squish(strip_tags($data['device_name'])), 80, '');
        if ($deviceName === '') {
            throw ValidationException::withMessages(['device_name' => ['Enter a device name.']]);
        }

        [$pairing, $token] = DB::transaction(function () use ($normalized, $deviceName) {
            $pairing = ExtensionPairingCode::query()
                ->with(['user.role.permissions'])
                ->where('code_hash', $this->hashCode($normalized))
                ->lockForUpdate()
                ->first();
            $user = $pairing?->user;
            if (! $pairing || $pairing->redeemed_at || $pairing->expires_at->isPast()
                || ! $user || $user->status !== 'active' || $user->archived_at || $user->deleted_at) {
                $this->invalidCode();
            }

            $pairing->update(['redeemed_at' => now()]);
            $token = $user->createToken(
                'Browser extension · '.$deviceName,
                ['extension-api'],
                now()->addDays(90),
            );

            return [$pairing, $token];
        });

        $request->setUserResolver(fn () => $pairing->user);
        $this->audit($request, 'extension.pairing.exchange', $token->accessToken, [
            'device_name' => $deviceName,
            'expires_at' => $token->accessToken->expires_at,
        ]);

        return $this->data([
            'token' => $token->plainTextToken,
            'expires_at' => $token->accessToken->expires_at,
            'user' => $this->extensionUser($pairing->user),
            'workspace' => $this->workspace(),
        ]);
    }

    public function devices(Request $request): JsonResponse
    {
        $tokens = $request->user()->tokens()
            ->whereJsonContains('abilities', 'extension-api')
            ->latest()
            ->get()
            ->map(fn ($token) => [
                'id' => $token->id,
                'name' => Str::after($token->name, 'Browser extension · '),
                'created_at' => $token->created_at,
                'last_used_at' => $token->last_used_at,
                'expires_at' => $token->expires_at,
            ]);

        return $this->data($tokens);
    }

    public function destroyDevice(Request $request, int $token): JsonResponse
    {
        $model = $request->user()->tokens()
            ->whereKey($token)
            ->whereJsonContains('abilities', 'extension-api')
            ->firstOrFail();
        $this->audit($request, 'extension.device.revoke', $model, ['name' => $model->name]);
        $model->delete();

        return response()->json(null, 204);
    }

    private function newCode(): array
    {
        do {
            $normalized = '';
            for ($i = 0; $i < 10; $i++) {
                $normalized .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
        } while (ExtensionPairingCode::query()->where('code_hash', $this->hashCode($normalized))->exists());

        return [substr($normalized, 0, 5).'-'.substr($normalized, 5), $normalized];
    }

    private function normalizeCode(string $code): string
    {
        return strtoupper(preg_replace('/[^A-Z0-9]/i', '', $code) ?? '');
    }

    private function hashCode(string $normalized): string
    {
        return hash_hmac('sha256', $normalized, (string) config('app.key'));
    }

    private function invalidCode(): never
    {
        throw ValidationException::withMessages([
            'code' => ['The pairing code is invalid, expired, or has already been used.'],
        ]);
    }

    private function extensionUser(User $user): array
    {
        return [
            'id' => $user->id,
            'username' => $user->username,
            'name' => trim($user->first_name.' '.$user->last_name),
            'permissions' => $user->permissions(),
        ];
    }

    private function workspace(): array
    {
        return [
            'name' => config('app.name'),
            'origin' => rtrim((string) config('app.frontend_url'), '/'),
        ];
    }
}
