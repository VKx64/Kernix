<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Support\UserIdentity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ProfileController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        return $this->data($this->present($request->user()));
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'first_name' => ['sometimes', 'required', 'string', 'max:64'],
            'last_name' => ['sometimes', 'nullable', 'string', 'max:64'],
            'personal_email' => ['sometimes', 'nullable', 'email', 'max:191', UserIdentity::uniqueRule($request->user())],
            'phone_1' => ['sometimes', 'nullable', 'string', 'max:64'],
            'timezone' => ['sometimes', 'nullable', 'timezone'],
            'theme_preset' => ['sometimes', 'string', 'max:64'],
            // profile_image is written only by the avatar endpoints. Accepting it
            // here would let an account point its picture at any stored path.
            'current_password' => ['required_with:password', 'nullable', 'string'],
            'password' => ['sometimes', 'nullable', 'string', 'min:8', 'max:255', 'confirmed'],
        ]);
        $user = $request->user();
        if (array_key_exists('last_name', $data)) {
            $data['last_name'] = (string) ($data['last_name'] ?? '');
        }
        $passwordChanged = filled($data['password'] ?? null);
        if ($passwordChanged) {
            if (! Hash::check((string) ($data['current_password'] ?? ''), $user->password_hash)) {
                throw ValidationException::withMessages(['current_password' => ['The current password is incorrect.']]);
            }
            $data['password_hash'] = Hash::make($data['password']);
        }
        unset($data['password'], $data['password_confirmation'], $data['current_password']);
        $before = $user->getAttributes();
        $user->update($data);
        if ($passwordChanged) {
            $sessions = DB::table('sessions')->where('user_id', $user->id);
            if ($request->hasSession()) {
                $sessions->where('id', '!=', $request->session()->getId());
            }
            $sessions->delete();
            $user->tokens()->delete();
            $user->forceFill(['remember_token' => Str::random(60)])->saveQuietly();
            $request->session()->regenerate();
        }
        $this->audit($request, 'profile.update', $user, ['before' => $before, 'after' => $user->getAttributes()]);

        return $this->data($this->present($user->fresh()));
    }

    private function present(User $user): array
    {
        $user->load(['role.permissions', 'department'])->makeVisible(User::PRIVATE_FIELDS);
        $data = $user->toArray();
        $data['name'] = trim($user->first_name.' '.$user->last_name);
        $data['permissions'] = $user->permissions();
        $data['is_admin'] = $user->isAdmin();

        return $data;
    }
}
