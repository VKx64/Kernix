<?php

namespace App\Support;

final class PermissionCatalog
{
    /**
     * This is the canonical, assignable permission contract shared by the API,
     * role validation, seeding, and the frontend role editor.
     *
     * @var array<int, array{group: string, permissions: array<int, array{key: string, label: string, description: string, requires: array<int, string>}>}>
     */
    private const GROUPS = [
        [
            'group' => 'Dashboard',
            'permissions' => [
                ['key' => 'dashboard.view', 'label' => 'View dashboard', 'description' => 'Open the dashboard and see permitted workspace summaries.', 'requires' => []],
            ],
        ],
        [
            'group' => 'Messages',
            'permissions' => [
                ['key' => 'messages.view', 'label' => 'View messages', 'description' => 'Read task messages and manage their read status.', 'requires' => []],
            ],
        ],
        [
            'group' => 'Time',
            'permissions' => [
                ['key' => 'time.track', 'label' => 'Track own time', 'description' => 'Clock in and out, take breaks, and view personal time summaries.', 'requires' => []],
                ['key' => 'time.view_team', 'label' => 'View team time', 'description' => 'See team clock-ins and team time summaries on the dashboard.', 'requires' => ['dashboard.view']],
            ],
        ],
        [
            'group' => 'Workspaces',
            'permissions' => [
                ['key' => 'workspaces.manage', 'label' => 'Manage workspaces', 'description' => 'Create and rename workspaces and choose who can work inside them.', 'requires' => []],
            ],
        ],
        [
            'group' => 'Tasks',
            'permissions' => [
                ['key' => 'tasks.view', 'label' => 'View tasks', 'description' => 'View all workspace tasks and their activity.', 'requires' => []],
                ['key' => 'tasks.work_unassigned', 'label' => 'Work on anyone\'s task', 'description' => 'Change tasks you are not the assignee of. Without this, work is limited to your own assignments and reviewers keep their own approvals.', 'requires' => ['tasks.view']],
                ['key' => 'tasks.request_work', 'label' => 'Request to work on a task', 'description' => 'Ask a project manager to be assigned to a task you picked up unexpectedly.', 'requires' => ['tasks.view', 'messages.view']],
                ['key' => 'tasks.review_work_requests', 'label' => 'Review work requests', 'description' => 'Approve or decline requests to be assigned to a task on managed projects.', 'requires' => ['tasks.assign', 'messages.view']],
                ['key' => 'tasks.create', 'label' => 'Create tasks', 'description' => 'Create new tasks while clocked in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.create_with_ai', 'label' => 'Create tasks with AI', 'description' => 'Turn a plain-language request into one or more tasks while clocked in.', 'requires' => ['tasks.create']],
                ['key' => 'tasks.edit', 'label' => 'Edit task details', 'description' => 'Edit task title, description, project, type, urgency, and due date while clocked in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.change_status', 'label' => 'Change task status', 'description' => 'Change task status and complete or reopen subtasks while clocked in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.comment', 'label' => 'Comment on tasks', 'description' => 'Add task notes and manage eligible notes you authored while clocked in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.log_time', 'label' => 'Log task time', 'description' => 'Add or change time on task notes while clocked in.', 'requires' => ['tasks.comment']],
                ['key' => 'tasks.subtasks', 'label' => 'Manage subtasks', 'description' => 'Create, edit, reorder, and remove subtasks while clocked in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.assign', 'label' => 'Assign tasks', 'description' => 'Assign tasks and subtasks to workspace users while clocked in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.estimate', 'label' => 'Set task estimates', 'description' => 'Change task and subtask estimates while clocked in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.request_estimate', 'label' => 'Request more task time', 'description' => 'Request an increase to the estimate of an assigned task while clocked in.', 'requires' => ['tasks.view', 'tasks.comment', 'messages.view']],
                ['key' => 'tasks.review_estimate_requests', 'label' => 'Review estimate requests', 'description' => 'Approve, adjust, or reject estimate increase requests for managed projects.', 'requires' => ['tasks.estimate', 'tasks.comment', 'messages.view']],
                ['key' => 'tasks.review_completion', 'label' => 'Review completion proof', 'description' => 'Approve or reject submitted proof of completion, including when the AI audit cannot decide.', 'requires' => ['tasks.view', 'tasks.change_status']],
                ['key' => 'tasks.attachments', 'label' => 'Manage task attachments', 'description' => 'Upload and remove task files while clocked in; viewing and downloading needs only task access.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.email', 'label' => 'Manage task email', 'description' => 'View captured task email at any time; sending or removing email requires an active clock-in.', 'requires' => ['tasks.view', 'time.track']],
                ['key' => 'tasks.archive', 'label' => 'Archive tasks', 'description' => 'Archive and restore tasks while clocked in.', 'requires' => ['tasks.view', 'time.track']],
            ],
        ],
        [
            'group' => 'Projects',
            'permissions' => [
                ['key' => 'projects.view', 'label' => 'View projects', 'description' => 'View all workspace projects.', 'requires' => []],
                ['key' => 'projects.create', 'label' => 'Create projects', 'description' => 'Create workspace projects.', 'requires' => ['projects.view']],
                ['key' => 'projects.edit', 'label' => 'Edit projects', 'description' => 'Edit workspace project details.', 'requires' => ['projects.view']],
                ['key' => 'projects.archive', 'label' => 'Archive projects', 'description' => 'Archive and restore workspace projects.', 'requires' => ['projects.view']],
                ['key' => 'projects.manage_ai_memory', 'label' => 'Manage AI project memory', 'description' => 'Draft, approve, reject, edit, and archive the AI handbook for managed projects.', 'requires' => ['projects.view']],
            ],
        ],
        [
            'group' => 'Forms',
            'permissions' => [
                ['key' => 'forms.view', 'label' => 'View project forms', 'description' => 'View a project\'s intake forms and their submission queue.', 'requires' => ['projects.view']],
                ['key' => 'forms.manage', 'label' => 'Manage project forms', 'description' => 'Create, edit, duplicate, and rotate the link for project intake forms.', 'requires' => ['forms.view']],
                ['key' => 'forms.review', 'label' => 'Review form submissions', 'description' => 'Convert or decline intake form submissions.', 'requires' => ['forms.view', 'tasks.create']],
            ],
        ],
        [
            'group' => 'Clients',
            'permissions' => [
                ['key' => 'clients.view', 'label' => 'View clients', 'description' => 'View all workspace clients.', 'requires' => []],
                ['key' => 'clients.create', 'label' => 'Create clients', 'description' => 'Create workspace clients.', 'requires' => ['clients.view']],
                ['key' => 'clients.edit', 'label' => 'Edit clients', 'description' => 'Edit workspace client details.', 'requires' => ['clients.view']],
                ['key' => 'clients.archive', 'label' => 'Archive clients', 'description' => 'Archive and restore workspace clients.', 'requires' => ['clients.view']],
            ],
        ],
        [
            'group' => 'Contacts',
            'permissions' => [
                ['key' => 'contacts.view', 'label' => 'View contacts', 'description' => 'View all workspace contacts.', 'requires' => []],
                ['key' => 'contacts.create', 'label' => 'Create contacts', 'description' => 'Create workspace contacts.', 'requires' => ['contacts.view']],
                ['key' => 'contacts.edit', 'label' => 'Edit contacts', 'description' => 'Edit workspace contact details.', 'requires' => ['contacts.view']],
                ['key' => 'contacts.archive', 'label' => 'Archive contacts', 'description' => 'Archive and restore workspace contacts.', 'requires' => ['contacts.view']],
            ],
        ],
        [
            'group' => 'Users',
            'permissions' => [
                ['key' => 'users.view', 'label' => 'View users', 'description' => 'View workspace users and safe account details.', 'requires' => []],
                ['key' => 'users.create', 'label' => 'Create users', 'description' => 'Create users within the permitted role boundary.', 'requires' => ['users.view']],
                ['key' => 'users.edit', 'label' => 'Edit users', 'description' => 'Edit users within the permitted security boundary.', 'requires' => ['users.view']],
                ['key' => 'users.archive', 'label' => 'Archive users', 'description' => 'Archive and restore users within the permitted security boundary.', 'requires' => ['users.view']],
            ],
        ],
        [
            'group' => 'Roles',
            'permissions' => [
                ['key' => 'roles.view', 'label' => 'View roles', 'description' => 'View roles, permissions, and assigned-user counts.', 'requires' => []],
            ],
        ],
        [
            'group' => 'Settings',
            'permissions' => [
                ['key' => 'settings.view', 'label' => 'View settings', 'description' => 'View workspace system settings.', 'requires' => []],
                ['key' => 'settings.edit', 'label' => 'Edit settings', 'description' => 'Change workspace system settings.', 'requires' => ['settings.view']],
            ],
        ],
        [
            'group' => 'Fields',
            'permissions' => [
                ['key' => 'fields.view', 'label' => 'View fields', 'description' => 'View configurable workspace fields and values.', 'requires' => []],
                ['key' => 'fields.create', 'label' => 'Create fields', 'description' => 'Create configurable workspace fields.', 'requires' => ['fields.view']],
                ['key' => 'fields.edit', 'label' => 'Edit fields', 'description' => 'Edit configurable workspace fields and values.', 'requires' => ['fields.view']],
                ['key' => 'fields.delete', 'label' => 'Delete fields', 'description' => 'Delete removable fields and field values.', 'requires' => ['fields.view']],
            ],
        ],
        [
            'group' => 'Analytics',
            'permissions' => [
                ['key' => 'analytics.view', 'label' => 'View analytics', 'description' => 'View workspace analytics and reports.', 'requires' => []],
            ],
        ],
    ];

    public static function groups(): array
    {
        return self::GROUPS;
    }

    /** @return array<int, string> */
    public static function keys(): array
    {
        return array_column(self::permissions(), 'key');
    }

    /** @return array<int, array{key: string, label: string, description: string, requires: array<int, string>}> */
    public static function permissions(): array
    {
        return array_merge(...array_column(self::GROUPS, 'permissions'));
    }

    /** @return array<int, string> */
    public static function requires(string $key): array
    {
        foreach (self::permissions() as $permission) {
            if ($permission['key'] === $key) {
                return $permission['requires'];
            }
        }

        return [];
    }

    /**
     * Return only grants that are known and whose complete dependency chain
     * is present. This keeps API responses and frontend controls aligned with
     * the authorization checks even if rows were inserted outside the API.
     *
     * @param  array<int, string>  $granted
     * @return array<int, string>
     */
    public static function effective(array $granted): array
    {
        $granted = array_values(array_unique($granted));

        // dashboard.view is the global custom-role invariant. If it is removed
        // outside the role API, fail closed instead of honoring the remaining
        // orphaned grants.
        if (! in_array('dashboard.view', $granted, true)) {
            return [];
        }

        return array_values(array_filter(
            self::keys(),
            fn (string $key): bool => self::allows($granted, $key)
        ));
    }

    /** @param array<int, string> $granted */
    public static function allows(array $granted, string $key): bool
    {
        if (! in_array('dashboard.view', $granted, true)
            || ! in_array($key, self::keys(), true)
            || ! in_array($key, $granted, true)) {
            return false;
        }

        return self::dependenciesSatisfied($granted, $key, []);
    }

    /**
     * @param  array<int, string>  $selected
     * @return array<string, array<int, string>> permission key => missing dependencies
     */
    public static function missingDependencies(array $selected): array
    {
        $selected = array_values(array_unique($selected));
        $missing = [];

        foreach ($selected as $key) {
            $required = array_values(array_filter(
                self::allRequirements($key),
                fn (string $dependency): bool => ! in_array($dependency, $selected, true)
            ));
            if ($required !== []) {
                $missing[$key] = $required;
            }
        }

        return $missing;
    }

    /**
     * @param  array<int, string>  $granted
     * @param  array<int, string>  $visited
     */
    private static function dependenciesSatisfied(array $granted, string $key, array $visited): bool
    {
        if (in_array($key, $visited, true)) {
            return false;
        }

        $visited[] = $key;
        foreach (self::requires($key) as $dependency) {
            if (! in_array($dependency, $granted, true)
                || ! self::dependenciesSatisfied($granted, $dependency, $visited)) {
                return false;
            }
        }

        return true;
    }

    /** @return array<int, string> */
    private static function allRequirements(string $key, array $visited = []): array
    {
        if (in_array($key, $visited, true)) {
            return [];
        }

        $visited[] = $key;
        $requirements = self::requires($key);
        foreach ($requirements as $dependency) {
            $requirements = array_merge($requirements, self::allRequirements($dependency, $visited));
        }

        return array_values(array_unique($requirements));
    }
}
