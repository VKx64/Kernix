<?php

namespace App\Support;

use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class UserSessionRevoker
{
    public static function forUser(User $user): int
    {
        return self::forUserIds([$user->id]);
    }

    public static function forRole(Role $role): int
    {
        return self::forUserIds(
            User::withTrashed()->where('role_id', $role->id)->pluck('id')->all()
        );
    }

    /**
     * @param  array<int, int|string>  $userIds
     * @return int number of affected users
     */
    public static function forUserIds(array $userIds): int
    {
        $ids = collect($userIds)->map(fn ($id) => (int) $id)->filter()->unique()->values();
        if ($ids->isEmpty()) {
            return 0;
        }

        DB::table('sessions')->whereIn('user_id', $ids)->delete();
        DB::table('personal_access_tokens')
            ->where('tokenable_type', (new User)->getMorphClass())
            ->whereIn('tokenable_id', $ids)
            ->delete();

        foreach ($ids as $id) {
            User::withTrashed()->whereKey($id)->update(['remember_token' => Str::random(60)]);
        }

        return $ids->count();
    }
}
