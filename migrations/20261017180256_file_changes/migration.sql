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
