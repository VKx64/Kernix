<?php

namespace Database\Factories;

use App\Models\Role;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

class UserFactory extends Factory
{
    protected static ?string $password = null;

    public function definition(): array
    {
        return [
            'role_id' => fn () => Role::firstOrCreate(
                ['key_name' => 'staff'],
                ['name' => 'Staff', 'is_system' => false, 'sort_order' => 20],
            )->id,
            'username' => fake()->unique()->userName(),
            'password_hash' => static::$password ??= Hash::make('password'),
            'first_name' => fake()->firstName(),
            'last_name' => fake()->lastName(),
            'imagic_email' => fake()->unique()->safeEmail(),
            'status' => 'active',
            'timezone' => 'Asia/Manila',
        ];
    }
}
