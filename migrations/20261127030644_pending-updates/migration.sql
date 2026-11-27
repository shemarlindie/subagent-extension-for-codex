CREATE TABLE `task_pending_updates` (
	`event_id` integer PRIMARY KEY,
	`task_id` text NOT NULL,
	`request_id` text,
	CONSTRAINT `fk_task_pending_updates_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_pending_updates_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `task_pending_updates_request` ON `task_pending_updates` (`task_id`,`request_id`);