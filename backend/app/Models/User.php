<?php

namespace App\Models;

use App\Support\CurrentWorkspace;
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
use Illuminate\Support\Facades\DB;
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
     * Self-registration deliberately creates an account with no workspace, so
     * the person can be walked through onboarding instead of being dropped into
     * somebody else's tenant.
     */
    private static bool $automaticWorkspace = true;

    /** The membership role for the active workspace, memoised per instance. */
    private ?int $workspaceRoleWorkspaceId = null;

    private ?int $workspaceRoleId = null;

    private bool $workspaceRoleResolved = false;

    /**
     * An account created inside this callback is left without a workspace.
     */
    public static function withoutAutomaticWorkspace(callable $callback): mixed
    {
        $previous = self::$automaticWorkspace;
        self::$automaticWorkspace = false;
        try {
            return $callback();
        } finally {
            self::$automaticWorkspace = $previous;
        }
    }

    /**
     * A new account always lands in a workspace, so nobody signs in to an empty
     * interface. Extra workspaces are granted from the workspace screen.
     */
    protected static function booted(): void
    {
        static::created(function (User $user) {
            if (! self::$automaticWorkspace || $user->workspaces()->exists()) {
                return;
            }
            // An admin adding a teammate from Settings > Users is acting inside
            // their own workspace, so the new account has to land there, not in
            // whichever workspace happens to have the lowest id. The blanket
            // fallback below only fires for console/seeder code with no request
            // in play, where there is no "current" workspace to prefer.
            $currentWorkspaceId = CurrentWorkspace::id();
            $workspace = ($currentWorkspaceId ? Workspace::query()->find($currentWorkspaceId) : null)
                ?? Workspace::query()->orderBy('id')->first()
                ?? Workspace::query()->create([
                    'name' => config('app.name', 'Workspace'),
                    'slug' => 'default',
                    'created_by' => $user->id,
                ]);
            $user->workspaces()->syncWithoutDetaching([$workspace->id => ['role_id' => $user->role_id]]);
            if (! $user->active_workspace_id) {
                $user->forceFill(['active_workspace_id' => $workspace->id])->saveQuietly();
            }
            $user->forgetWorkspaceRole();
        });

        // Administration still edits `users.role_id`, so the membership for the
        // workspace the person is in has to follow it or the change would look
        // like it did nothing.
        static::updated(function (User $user) {
            if (! $user->wasChanged('role_id') || ! $user->active_workspace_id) {
                return;
            }
            DB::table('workspace_user')
                ->where('user_id', $user->getKey())
                ->where('workspace_id', $user->active_workspace_id)
                ->update(['role_id' => $user->role_id, 'updated_at' => now()]);
            $user->forgetWorkspaceRole();
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

    /**
     * The role the person holds in the workspace they are currently in. The
     * foreign key is resolved by `effective_role_id`, which reads the membership
     * first and falls back to the legacy `users.role_id` column, so eager loads,
     * lazy loads, and serialised output all describe the same role.
     *
     * The global workspace scope is dropped here on purpose: the role is already
     * chosen by workspace, and the relation still has to resolve while no
     * workspace is current, e.g. during login.
     */
    /**
     * The relation keys on the real `role_id` column so it can be eager loaded
     * — `with('role.permissions')` is used in a dozen controllers, and a
     * belongsTo pointed at an accessor cannot be batched into a query.
     *
     * What the person can actually *do* comes from `effectiveRole()`, which
     * prefers their role in the workspace being served. This relation is the
     * legacy fallback and the serialised shape.
     */
    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class, 'role_id')->withoutGlobalScope('workspace');
    }

    /** The role that decides permissions here: workspace membership first. */
    public function effectiveRole(): ?Role
    {
        $roleId = $this->effective_role_id;
        if ($roleId === null) {
            return null;
        }
        if ($this->relationLoaded('role') && (int) ($this->role?->id ?? 0) === (int) $roleId) {
            return $this->role;
        }

        return Role::query()->withoutGlobalScope('workspace')->with('permissions')->find($roleId);
    }

    public function getEffectiveRoleIdAttribute(): ?int
    {
        $membershipRoleId = $this->workspaceRoleId();
        if ($membershipRoleId !== null) {
            return $membershipRoleId;
        }

        // The legacy column is a migration fallback, not a passport. It only
        // applies where the person is actually a member; without this, someone
        // who founded one workspace would carry its role into every other.
        return $this->belongsToCurrentWorkspace() ? ($this->attributes['role_id'] ?? null) : null;
    }

    /**
     * The role recorded on the membership for the workspace being served.
     *
     * Keyed on the *current* workspace rather than the user's own active one:
     * a queued job or an admin tool can run inside a workspace that is not the
     * person's own, and permissions have to be judged where the work is
     * happening, not where the account happens to be pointed.
     */
    private function workspaceRoleId(): ?int
    {
        $workspaceId = CurrentWorkspace::id() ?? ($this->attributes['active_workspace_id'] ?? null);
        if (! $workspaceId || ! $this->exists) {
            return null;
        }
        if ($this->workspaceRoleResolved && $this->workspaceRoleWorkspaceId === (int) $workspaceId) {
            return $this->workspaceRoleId;
        }

        $roleId = DB::table('workspace_user')
            ->where('user_id', $this->getKey())
            ->where('workspace_id', $workspaceId)
            ->value('role_id');

        $this->workspaceRoleWorkspaceId = (int) $workspaceId;
        $this->workspaceRoleId = $roleId === null ? null : (int) $roleId;
        $this->workspaceRoleResolved = true;

        return $this->workspaceRoleId;
    }

    /** Membership in the workspace currently being served. */
    public function belongsToCurrentWorkspace(): bool
    {
        $workspaceId = CurrentWorkspace::id();
        if (! $workspaceId || ! $this->exists) {
            // No workspace in play — login, a console command — so the legacy
            // column is all there is to go on.
            return true;
        }

        return DB::table('workspace_user')
            ->where('user_id', $this->getKey())
            ->where('workspace_id', $workspaceId)
            ->exists();
    }

    public function forgetWorkspaceRole(): void
    {
        $this->workspaceRoleResolved = false;
        $this->workspaceRoleId = null;
        $this->workspaceRoleWorkspaceId = null;
        $this->unsetRelation('role');
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
        return $this->belongsToMany(Workspace::class, 'workspace_user')->withPivot('role_id')->withTimestamps();
    }

    /**
     * Users are not workspace-owned rows the way tasks or roles are — one
     * account can belong to several workspaces — so they cannot carry the
     * `BelongsToWorkspace` trait's automatic global scope. Anything listing or
     * looking up users for a tenant-facing screen has to filter through this
     * scope explicitly instead.
     */
    public function scopeInWorkspace($query, ?int $workspaceId)
    {
        return $query->whereHas('workspaces', fn ($workspaces) => $workspaces->whereKey($workspaceId));
    }

    /** True until the person has joined or created their first workspace. */
    public function needsWorkspace(): bool
    {
        return ! $this->workspaces()->exists();
    }

    public function activeWorkspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class, 'active_workspace_id');
    }

    public function isAdmin(): bool
    {
        return $this->effectiveRole()?->key_name === 'admin';
    }

    public function permissions(): array
    {
        $role = $this->effectiveRole();
        if ($role && ! $role->relationLoaded('permissions')) {
            $role->load('permissions');
        }

        if ($role?->key_name === 'admin') {
            return PermissionCatalog::keys();
        }

        return PermissionCatalog::effective(
            $role?->permissions->pluck('permission_key')->all() ?? []
        );
    }

    public function canDo(string $permission): bool
    {
        return $this->isAdmin() || in_array($permission, $this->permissions(), true);
    }
}
