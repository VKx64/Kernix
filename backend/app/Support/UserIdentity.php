<?php

namespace App\Support;

use App\Models\User;
use Closure;

class UserIdentity
{
    public static function uniqueRule(?User $ignore = null): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($ignore): void {
            if (! is_string($value) || trim($value) === '') {
                return;
            }

            $identity = mb_strtolower(trim($value));
            $query = User::withTrashed();
            if ($ignore) {
                $query->whereKeyNot($ignore->id);
            }
            $query->where(function ($users) use ($identity): void {
                $users->whereRaw('LOWER(username) = ?', [$identity])
                    ->orWhereRaw('LOWER(imagic_email) = ?', [$identity])
                    ->orWhereRaw('LOWER(personal_email) = ?', [$identity]);
            });

            if ($query->exists()) {
                $fail("The {$attribute} is already used as a sign-in identity.");
            }
        };
    }
}
