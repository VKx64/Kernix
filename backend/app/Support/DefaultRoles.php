<?php

namespace App\Support;

final class DefaultRoles
{
    /**
     * Default custom roles are starter presets, not immutable system roles.
     * The seeder creates each preset once and deliberately leaves later edits
     * or deletions alone.
     *
     * @return array<int, array{name: string, key_name: string, sort_order: int, permissions: array<int, string>}>
     */
    public static function definitions(): array
    {
        return [
            [
                'name' => 'Project Management Role',
                'key_name' => 'project_management_role',
                'sort_order' => 20,
                'permissions' => [
                    'dashboard.view',
                    'messages.view',
                    'time.track',
                    'time.view_team',
                    'tasks.view',
                    'tasks.work_unassigned',
                    'tasks.review_work_requests',
                    'tasks.create',
                    'tasks.create_with_ai',
                    'tasks.edit',
                    'tasks.change_status',
                    'tasks.comment',
                    'tasks.log_time',
                    'tasks.subtasks',
                    'tasks.assign',
                    'tasks.estimate',
                    'tasks.review_estimate_requests',
                    'tasks.email',
                    'tasks.archive',
                    'projects.view',
                    'projects.create',
                    'projects.edit',
                    'projects.archive',
                    'projects.manage_ai_memory',
                    'clients.view',
                    'clients.create',
                    'clients.edit',
                    'contacts.view',
                    'contacts.create',
                    'contacts.edit',
                    'users.view',
                    'analytics.view',
                ],
            ],
            [
                'name' => 'Employee Role',
                'key_name' => 'employee_role',
                'sort_order' => 30,
                'permissions' => [
                    'dashboard.view',
                    'messages.view',
                    'time.track',
                    'tasks.view',
                    'tasks.change_status',
                    'tasks.comment',
                    'tasks.log_time',
                    'tasks.subtasks',
                    'tasks.request_estimate',
                    'tasks.request_work',
                ],
            ],
            [
                'name' => 'Client Role',
                'key_name' => 'client_role',
                'sort_order' => 40,
                'permissions' => [
                    'dashboard.view',
                ],
            ],
        ];
    }
}
