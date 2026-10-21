CREATE TABLE `file_changes` (
	`task_id` text NOT NULL,
	`scope` text NOT NULL,
	`path` text NOT NULL,
	`hunks` text NOT NULL,
	`created` integer NOT NULL,
	`deleted` integer NOT NULL,
	`source` text NOT NULL,
	`incomplete` integer NOT NULL,
	CONSTRAINT `file_changes_pk` PRIMARY KEY(`task_id`, `scope`, `path`),
	CONSTRAINT `fk_file_changes_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_roots` (
	`path` text PRIMARY KEY,
	`kind` text NOT NULL,
	`name` text
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`owner` text PRIMARY KEY,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`timestamp` text NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `fk_events_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_send_receipts` (
	`owner` text NOT NULL,
	`task_id` text NOT NULL,
	`sender` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`message_id` text NOT NULL,
	`state` text NOT NULL,
	CONSTRAINT `task_send_receipts_pk` PRIMARY KEY(`owner`, `task_id`, `sender`, `request_id`),
	CONSTRAINT `fk_task_send_receipts_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_archive` (
	`task_id` text PRIMARY KEY,
	`archived_at` text NOT NULL,
	CONSTRAINT `fk_task_archive_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_read` (
	`task_id` text PRIMARY KEY,
	`through` integer NOT NULL,
	`unread` integer NOT NULL,
	CONSTRAINT `fk_task_read_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_task` ON `events` (`task_id`,`id`);