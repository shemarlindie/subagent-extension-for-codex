CREATE TABLE `event_checkpoint` (
	`id` integer PRIMARY KEY,
	`cursor` integer NOT NULL,
	CONSTRAINT "event_checkpoint_singleton" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `event_outbox` (
	`subscription_id` text NOT NULL,
	`event_id` text NOT NULL,
	`task_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `event_outbox_pk` PRIMARY KEY(`subscription_id`, `event_id`),
	CONSTRAINT `fk_event_outbox_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `event_subscriptions` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_roots` (
	`path` text PRIMARY KEY,
	`kind` text NOT NULL
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
CREATE TABLE `form_requests` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`expires` integer NOT NULL,
	`task_id` text,
	`body` text NOT NULL,
	CONSTRAINT `fk_form_requests_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_outbox_task` ON `event_outbox` (`task_id`);--> statement-breakpoint
CREATE INDEX `events_task` ON `events` (`task_id`,`id`);--> statement-breakpoint
CREATE INDEX `form_requests_task` ON `form_requests` (`task_id`);--> statement-breakpoint
INSERT INTO `event_checkpoint` (`id`, `cursor`) VALUES (1, 0);
