<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends ApiController
{
    public function login(Request $request): JsonResponse
    {
        $input = $request->validate([
            'login' => ['nullable', 'string', 'max:191', 'required_without:username'],
            'username' => ['nullable', 'string', 'max:191', 'required_without:login'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
        ]);
        $login = mb_strtolower(trim($input['login'] ?? $input['username']));
        $activeUsers = User::with(['role.permissions', 'department'])
            ->whereNull('archived_at')
            ->where('status', 'active');
        $user = (clone $activeUsers)->whereRaw('LOWER(username) = ?', [$login])->first();
        if (! $user) {
            $emailMatches = (clone $activeUsers)
                ->where(fn ($query) => $query
                    ->whereRaw('LOWER(imagic_email) = ?', [$login])
                    ->orWhereRaw('LOWER(personal_email) = ?', [$login]))
                ->limit(2)
                ->get();
            $user = $emailMatches->count() === 1 ? $emailMatches->first() : null;
        }

        if (! $user || ! Hash::check($input['password'], $user->password_hash)) {
            throw ValidationException::withMessages(['login' => ['The provided credentials are invalid.']]);
        }

        Auth::login($user, (bool) ($input['remember'] ?? false));
        $request->session()->regenerate();
        $user->forceFill(['last_login_at' => now(), 'last_login_ip' => $request->ip()])->save();

        return $this->data($this->presentUser($user));
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Logged out.']);
    }

    public function user(Request $request): JsonResponse
    {
        return $this->data($this->presentUser($request->user()->load(['role.permissions', 'department'])));
    }

    private function presentUser(User $user): array
    {
        $user->makeVisible(User::PRIVATE_FIELDS);
        $data = $user->toArray();
        $data['name'] = trim($user->first_name.' '.$user->last_name);
        $data['permissions'] = $user->permissions();
        $data['is_admin'] = $user->isAdmin();
        $data['can_admin_override'] = $user->isAdmin();

        return $data;
    }
}
