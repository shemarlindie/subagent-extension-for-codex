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
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_task` ON `events` (`task_id`,`id`);