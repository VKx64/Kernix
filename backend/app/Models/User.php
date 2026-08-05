<?php

namespace App\Models;

use App\Support\PermissionCatalog;
use Database\Factories\UserFactory;
use App\Services\AvatarStorage;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    public const PRIVATE_FIELDS = [
        'personal_email', 'phone_1', 'phone_2', 'wise_account', 'gcash_account',
        'start_date', 'birthdate', 'home_address', 'barangay', 'city', 'province',
        'zip_code', 'last_login_ip',
    ];

    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable, SoftDeletes;

    protected $guarded = [];

    protected $hidden = [
        'password_hash', 'remember_token', 'personal_email', 'phone_1', 'phone_2',
        'wise_account', 'gcash_account', 'start_date', 'birthdate', 'home_address',
        'barangay', 'city', 'province', 'zip_code', 'last_login_ip',
    ];

    protected function casts(): array
    {
        return ['start_date' => 'date', 'birthdate' => 'date', 'last_login_at' => 'datetime', 'archived_at' => 'datetime'];
    }

    /**
     * The column holds a storage path for uploaded pictures, but the clients
     * need something they can put in a src attribute. Reads resolve to the
     * route that serves the file; writes still store the path. Values that were
     * already external URLs pass through untouched.
     */
    protected function profileImage(): Attribute
    {
        return Attribute::get(function (?string $value): ?string {
            if (! AvatarStorage::isStoredPath($value)) {
                return $value;
            }

            // The filename changes on every upload, so carrying it as a version
            // lets the response stay cacheable without pinning a stale picture.
            $version = pathinfo($value, PATHINFO_FILENAME);

            return url("/api/users/{$this->getKey()}/avatar").'?v='.$version;
        });
    }

    /**
     * A new account always lands in a workspace, so nobody signs in to an empty
     * interface. Extra workspaces are granted from the workspace screen.
     */
    protected static function booted(): void
    {
        static::created(function (User $user) {
            if ($user->workspaces()->exists()) {
                return;
            }
            $workspace = Workspace::query()->orderBy('id')->first()
                ?? Workspace::query()->create([
                    'name' => config('app.name', 'Workspace'),
                    'slug' => 'default',
                    'created_by' => $user->id,
                ]);
            $user->workspaces()->syncWithoutDetaching([$workspace->id]);
            if (! $user->active_workspace_id) {
                $user->forceFill(['active_workspace_id' => $workspace->id])->saveQuietly();
            }
        });
    }

    public function getAuthPasswordName(): string
    {
        return 'password_hash';
    }

    public function getAuthPassword(): string
    {
        return (string) $this->password_hash;
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(FieldValue::class, 'department_value_id');
    }

    public function timeSessions(): HasMany
    {
        return $this->hasMany(TimeSession::class);
    }

    public function projects(): BelongsToMany
    {
        return $this->belongsToMany(Project::class)->withPivot('assigned_by')->withTimestamps();
    }

    public function workspaces(): BelongsToMany
    {
        return $this->belongsToMany(Workspace::class, 'workspace_user')->withTimestamps();
    }

    public function activeWorkspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class, 'active_workspace_id');
    }

    public function isAdmin(): bool
    {
        return $this->role?->key_name === 'admin';
    }

    public function permissions(): array
    {
        if (! $this->relationLoaded('role')) {
            $this->load('role.permissions');
        } elseif ($this->role && ! $this->role->relationLoaded('permissions')) {
            $this->role->load('permissions');
        }

        if ($this->isAdmin()) {
            return PermissionCatalog::keys();
        }

        return PermissionCatalog::effective(
            $this->role?->permissions->pluck('permission_key')->all() ?? []
        );
    }

    public function canDo(string $permission): bool
    {
        return $this->isAdmin() || in_array($permission, $this->permissions(), true);
    }
}
