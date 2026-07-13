SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+08:00';

CREATE TABLE `roles` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `key_name` VARCHAR(128) NOT NULL,
    `is_system` TINYINT(1) NOT NULL DEFAULT 0,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_roles_key_name` (`key_name`),
    KEY `idx_roles_deleted_sort` (`deleted_at`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `role_permissions` (
    `role_id` INT UNSIGNED NOT NULL,
    `permission_key` VARCHAR(128) NOT NULL,
    PRIMARY KEY (`role_id`, `permission_key`),
    CONSTRAINT `fk_role_permissions_role`
        FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `fields` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `key_name` VARCHAR(128) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` TINYINT(1) NOT NULL DEFAULT 1,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_fields_key_name` (`key_name`),
    KEY `idx_fields_deleted_sort` (`deleted_at`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `field_values` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `field_id` INT UNSIGNED NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `key_name` VARCHAR(128) NOT NULL,
    `color` VARCHAR(32) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'active',
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_field_values_key` (`field_id`, `key_name`),
    KEY `idx_field_values_lookup` (`field_id`, `status`, `deleted_at`, `sort_order`),
    CONSTRAINT `fk_field_values_field`
        FOREIGN KEY (`field_id`) REFERENCES `fields` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `role_id` INT UNSIGNED NOT NULL,
    `username` VARCHAR(128) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `first_name` VARCHAR(64) NOT NULL,
    `last_name` VARCHAR(64) NOT NULL DEFAULT '',
    `imagic_email` VARCHAR(191) NULL,
    `personal_email` VARCHAR(191) NULL,
    `phone_1` VARCHAR(64) NULL,
    `phone_2` VARCHAR(64) NULL,
    `department_value_id` INT UNSIGNED NULL,
    `wise_account` VARCHAR(191) NULL,
    `gcash_account` VARCHAR(191) NULL,
    `start_date` DATE NULL,
    `birthdate` DATE NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'active',
    `home_address` TEXT NULL,
    `barangay` VARCHAR(128) NULL,
    `city` VARCHAR(128) NULL,
    `province` VARCHAR(128) NULL,
    `zip_code` VARCHAR(32) NULL,
    `timezone` VARCHAR(64) NULL,
    `profile_image` VARCHAR(500) NULL,
    `theme_preset` VARCHAR(64) NOT NULL DEFAULT 'imagic_purple',
    `last_login_at` DATETIME NULL,
    `last_login_ip` VARCHAR(45) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `archived_at` DATETIME NULL,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_username` (`username`),
    KEY `idx_users_role` (`role_id`),
    KEY `idx_users_status` (`status`, `archived_at`, `deleted_at`),
    CONSTRAINT `fk_users_role`
        FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
    CONSTRAINT `fk_users_department`
        FOREIGN KEY (`department_value_id`) REFERENCES `field_values` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `clients` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `website` VARCHAR(500) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(64) NULL,
    `address` TEXT NULL,
    `city` VARCHAR(128) NULL,
    `province` VARCHAR(128) NULL,
    `zip_code` VARCHAR(32) NULL,
    `country` VARCHAR(128) NULL,
    `timezone` VARCHAR(64) NULL,
    `notes` TEXT NULL,
    `status_value_id` INT UNSIGNED NULL,
    `created_by` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `archived_at` DATETIME NULL,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_clients_name` (`name`),
    KEY `idx_clients_status` (`status_value_id`),
    KEY `idx_clients_active` (`archived_at`, `deleted_at`),
    CONSTRAINT `fk_clients_status`
        FOREIGN KEY (`status_value_id`) REFERENCES `field_values` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_clients_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `contacts` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT UNSIGNED NOT NULL,
    `first_name` VARCHAR(128) NOT NULL,
    `last_name` VARCHAR(128) NOT NULL DEFAULT '',
    `title` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone_1` VARCHAR(64) NULL,
    `phone_2` VARCHAR(64) NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'active',
    `created_by` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `archived_at` DATETIME NULL,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_contacts_client` (`client_id`),
    KEY `idx_contacts_name` (`last_name`, `first_name`),
    KEY `idx_contacts_active` (`archived_at`, `deleted_at`),
    CONSTRAINT `fk_contacts_client`
        FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`),
    CONSTRAINT `fk_contacts_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `projects` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT UNSIGNED NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status_value_id` INT UNSIGNED NULL,
    `manager_user_id` INT UNSIGNED NULL,
    `start_date` DATE NULL,
    `due_date` DATE NULL,
    `created_by` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `archived_at` DATETIME NULL,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_projects_client` (`client_id`),
    KEY `idx_projects_manager` (`manager_user_id`),
    KEY `idx_projects_status` (`status_value_id`),
    KEY `idx_projects_active_due` (`archived_at`, `deleted_at`, `due_date`),
    CONSTRAINT `fk_projects_client`
        FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`),
    CONSTRAINT `fk_projects_status`
        FOREIGN KEY (`status_value_id`) REFERENCES `field_values` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_projects_manager`
        FOREIGN KEY (`manager_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_projects_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `tasks` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `project_id` INT UNSIGNED NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` LONGTEXT NULL,
    `status_value_id` INT UNSIGNED NULL,
    `type_value_id` INT UNSIGNED NULL,
    `urgency_value_id` INT UNSIGNED NULL,
    `due_date` DATE NULL,
    `assignee_user_id` INT UNSIGNED NULL,
    `estimated_minutes` INT UNSIGNED NULL,
    `actual_minutes` INT UNSIGNED NOT NULL DEFAULT 0,
    `created_by` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `archived_at` DATETIME NULL,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_tasks_project` (`project_id`),
    KEY `idx_tasks_assignee` (`assignee_user_id`),
    KEY `idx_tasks_status` (`status_value_id`),
    KEY `idx_tasks_urgency` (`urgency_value_id`),
    KEY `idx_tasks_active_due` (`archived_at`, `deleted_at`, `due_date`),
    CONSTRAINT `fk_tasks_project`
        FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
    CONSTRAINT `fk_tasks_status`
        FOREIGN KEY (`status_value_id`) REFERENCES `field_values` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_tasks_type`
        FOREIGN KEY (`type_value_id`) REFERENCES `field_values` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_tasks_urgency`
        FOREIGN KEY (`urgency_value_id`) REFERENCES `field_values` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_tasks_assignee`
        FOREIGN KEY (`assignee_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_tasks_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `task_subtasks` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `task_id` INT UNSIGNED NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `status_value_id` INT UNSIGNED NULL,
    `assignee_user_id` INT UNSIGNED NULL,
    `due_date` DATE NULL,
    `estimated_minutes` INT UNSIGNED NULL,
    `actual_minutes` INT UNSIGNED NOT NULL DEFAULT 0,
    `sort_order` INT NOT NULL DEFAULT 0,
    `completed_at` DATETIME NULL,
    `created_by` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_subtasks_task` (`task_id`, `deleted_at`, `sort_order`),
    KEY `idx_subtasks_assignee` (`assignee_user_id`),
    CONSTRAINT `fk_subtasks_task`
        FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_subtasks_status`
        FOREIGN KEY (`status_value_id`) REFERENCES `field_values` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_subtasks_assignee`
        FOREIGN KEY (`assignee_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_subtasks_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `task_notes` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `task_id` INT UNSIGNED NOT NULL,
    `subtask_id` INT UNSIGNED NULL,
    `body` LONGTEXT NOT NULL,
    `time_minutes` INT UNSIGNED NULL,
    `time_logged_by` INT UNSIGNED NULL,
    `assigned_user_id` INT UNSIGNED NULL,
    `created_by` INT UNSIGNED NULL,
    `is_message` TINYINT(1) NOT NULL DEFAULT 0,
    `read_at` DATETIME NULL,
    `read_by_user_id` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_task_notes_task` (`task_id`, `deleted_at`, `created_at`),
    KEY `idx_task_notes_messages` (`assigned_user_id`, `is_message`, `read_at`, `deleted_at`),
    KEY `idx_task_notes_time` (`time_logged_by`, `created_at`, `deleted_at`),
    CONSTRAINT `fk_task_notes_task`
        FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_task_notes_subtask`
        FOREIGN KEY (`subtask_id`) REFERENCES `task_subtasks` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_task_notes_time_logger`
        FOREIGN KEY (`time_logged_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_task_notes_assigned_user`
        FOREIGN KEY (`assigned_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_task_notes_created_by`
        FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_task_notes_read_by`
        FOREIGN KEY (`read_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `note_attachments` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `note_id` INT UNSIGNED NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `storage_path` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(191) NULL,
    `file_size` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `storage_driver` VARCHAR(32) NOT NULL DEFAULT 'local',
    `uploaded_by` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_note_attachments_note` (`note_id`, `deleted_at`),
    CONSTRAINT `fk_note_attachments_note`
        FOREIGN KEY (`note_id`) REFERENCES `task_notes` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_note_attachments_uploaded_by`
        FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `task_emails` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `task_id` INT UNSIGNED NOT NULL,
    `sent_by` INT UNSIGNED NULL,
    `to_addresses` TEXT NOT NULL,
    `cc_addresses` TEXT NULL,
    `bcc_addresses` TEXT NULL,
    `subject` VARCHAR(500) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
    `error_message` TEXT NULL,
    `sent_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_task_emails_task` (`task_id`, `deleted_at`, `created_at`),
    CONSTRAINT `fk_task_emails_task`
        FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_task_emails_sent_by`
        FOREIGN KEY (`sent_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `email_attachments` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email_id` INT UNSIGNED NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(191) NULL,
    `file_size` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `storage_driver` VARCHAR(32) NOT NULL DEFAULT 'local',
    `storage_path` VARCHAR(500) NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,
    PRIMARY KEY (`id`),
    KEY `idx_email_attachments_email` (`email_id`, `deleted_at`),
    CONSTRAINT `fk_email_attachments_email`
        FOREIGN KEY (`email_id`) REFERENCES `task_emails` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `time_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NOT NULL,
    `clock_in_at` DATETIME NOT NULL,
    `clock_out_at` DATETIME NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_time_sessions_user_open` (`user_id`, `clock_out_at`, `clock_in_at`),
    CONSTRAINT `fk_time_sessions_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `time_breaks` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `session_id` BIGINT UNSIGNED NOT NULL,
    `start_at` DATETIME NOT NULL,
    `end_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_time_breaks_session` (`session_id`, `end_at`, `start_at`),
    CONSTRAINT `fk_time_breaks_session`
        FOREIGN KEY (`session_id`) REFERENCES `time_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` INT UNSIGNED NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(64) NULL,
    `entity_id` BIGINT UNSIGNED NULL,
    `summary` VARCHAR(500) NULL,
    `changes_json` LONGTEXT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(500) NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_audit_entity` (`entity_type`, `entity_id`, `created_at`),
    KEY `idx_audit_user` (`user_id`, `created_at`),
    CONSTRAINT `fk_audit_logs_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `system_settings` (
    `id` TINYINT UNSIGNED NOT NULL,
    `default_timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
    `system_logo` VARCHAR(500) NULL,
    `sidebar_logo` VARCHAR(500) NULL,
    `email_logo` VARCHAR(500) NULL,
    `favicon` VARCHAR(500) NULL,
    `smtp_host` VARCHAR(255) NULL,
    `smtp_port` INT UNSIGNED NOT NULL DEFAULT 587,
    `smtp_encryption` VARCHAR(16) NOT NULL DEFAULT 'tls',
    `smtp_username` VARCHAR(255) NULL,
    `smtp_password` VARCHAR(500) NULL,
    `smtp_from_email` VARCHAR(191) NULL,
    `smtp_from_name` VARCHAR(191) NULL,
    `storage_driver` VARCHAR(32) NOT NULL DEFAULT 'local',
    `local_upload_path` VARCHAR(500) NOT NULL DEFAULT 'uploads',
    `local_public_url` VARCHAR(500) NULL,
    `s3_bucket` VARCHAR(255) NULL,
    `s3_region` VARCHAR(64) NULL,
    `s3_access_key` VARCHAR(255) NULL,
    `s3_secret_key` VARCHAR(500) NULL,
    `s3_endpoint` VARCHAR(500) NULL,
    `s3_public_url_base` VARCHAR(500) NULL,
    `s3_use_path_style` TINYINT(1) NOT NULL DEFAULT 0,
    `single_client_mode` TINYINT(1) NOT NULL DEFAULT 0,
    `single_client_id` INT UNSIGNED NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_system_settings_single_client`
        FOREIGN KEY (`single_client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `roles` (`id`, `name`, `key_name`, `is_system`, `sort_order`)
VALUES (1, 'Administrator', 'admin', 1, 1);

INSERT INTO `role_permissions` (`role_id`, `permission_key`) VALUES
    (1, 'dashboard.view'),
    (1, 'messages.view'),
    (1, 'tasks.view'),
    (1, 'tasks.create'),
    (1, 'tasks.edit'),
    (1, 'tasks.archive'),
    (1, 'tasks.delete'),
    (1, 'tasks.assign'),
    (1, 'projects.view'),
    (1, 'projects.create'),
    (1, 'projects.edit'),
    (1, 'projects.archive'),
    (1, 'projects.delete'),
    (1, 'clients.view'),
    (1, 'clients.create'),
    (1, 'clients.edit'),
    (1, 'clients.archive'),
    (1, 'clients.delete'),
    (1, 'contacts.view'),
    (1, 'contacts.create'),
    (1, 'contacts.edit'),
    (1, 'contacts.archive'),
    (1, 'contacts.delete'),
    (1, 'users.view'),
    (1, 'users.create'),
    (1, 'users.edit'),
    (1, 'users.archive'),
    (1, 'users.delete'),
    (1, 'roles.view'),
    (1, 'roles.create'),
    (1, 'roles.edit'),
    (1, 'roles.delete'),
    (1, 'settings.view'),
    (1, 'settings.edit'),
    (1, 'fields.view'),
    (1, 'fields.create'),
    (1, 'fields.edit'),
    (1, 'fields.delete'),
    (1, 'analytics.view');

INSERT INTO `fields` (`id`, `name`, `key_name`, `description`, `sort_order`) VALUES
    (1, 'Client Status', 'client_status', 'Lifecycle status for clients', 10),
    (2, 'Project Status', 'project_status', 'Lifecycle status for projects', 20),
    (3, 'Task Status', 'task_status', 'Workflow status for tasks and subtasks', 30),
    (4, 'Task Urgency', 'task_urgency', 'Priority ordering for tasks', 40),
    (5, 'Task Type', 'task_type', 'Category of work', 50),
    (6, 'User Department', 'user_department', 'Team or department for users', 60);

INSERT INTO `field_values` (`id`, `field_id`, `label`, `key_name`, `color`, `sort_order`) VALUES
    (1, 1, 'Active', 'active', '#22c55e', 10),
    (2, 1, 'Prospect', 'prospect', '#3b82f6', 20),
    (3, 1, 'On Hold', 'on_hold', '#f59e0b', 30),
    (4, 1, 'Inactive', 'inactive', '#64748b', 40),

    (5, 2, 'Planning', 'planning', '#8b5cf6', 10),
    (6, 2, 'Active', 'active', '#22c55e', 20),
    (7, 2, 'On Hold', 'on_hold', '#f59e0b', 30),
    (8, 2, 'Complete', 'complete', '#64748b', 40),

    (9, 3, 'Pending', 'pending', '#64748b', 10),
    (10, 3, 'In Progress', 'in_progress', '#3b82f6', 20),
    (11, 3, 'Blocked', 'blocked', '#ef4444', 30),
    (12, 3, 'Complete', 'complete', '#22c55e', 40),

    (13, 4, 'Urgent', 'urgent', '#ef4444', 10),
    (14, 4, 'High', 'high', '#f97316', 20),
    (15, 4, 'Normal', 'normal', '#3b82f6', 30),
    (16, 4, 'Low', 'low', '#64748b', 40),

    (17, 5, 'Task', 'task', '#3b82f6', 10),
    (18, 5, 'Bug', 'bug', '#ef4444', 20),
    (19, 5, 'Feature', 'feature', '#8b5cf6', 30),
    (20, 5, 'Request', 'request', '#14b8a6', 40),

    (21, 6, 'Management', 'management', '#8b5cf6', 10),
    (22, 6, 'Production', 'production', '#3b82f6', 20),
    (23, 6, 'Design', 'design', '#ec4899', 30),
    (24, 6, 'Development', 'development', '#14b8a6', 40),
    (25, 6, 'Operations', 'operations', '#f59e0b', 50);

INSERT INTO `users` (
    `id`, `role_id`, `username`, `password_hash`, `first_name`, `last_name`,
    `department_value_id`, `status`, `timezone`, `theme_preset`
) VALUES (
    1, 1, 'admin', '$2y$10$l7t9pjNAEBqv6kINbcycyu9p9eI16mkQQ9JPI5/6ZkiJd0kr2/S.6',
    'Admin', 'User', 21, 'active', 'Asia/Manila', 'imagic_purple'
);

INSERT INTO `system_settings` (
    `id`, `default_timezone`, `smtp_port`, `smtp_encryption`,
    `storage_driver`, `local_upload_path`, `single_client_mode`
) VALUES (1, 'Asia/Manila', 587, 'tls', 'local', 'uploads', 0);
