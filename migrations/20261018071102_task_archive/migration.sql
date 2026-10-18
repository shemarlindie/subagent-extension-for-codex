CREATE TABLE `task_archive` (
	`task_id` text PRIMARY KEY,
	`archived_at` text NOT NULL,
	CONSTRAINT `fk_task_archive_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
