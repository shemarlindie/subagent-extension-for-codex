CREATE TABLE `task_attachments` (
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`format` text NOT NULL,
	`path` text,
	`source` text NOT NULL,
	`file` text NOT NULL,
	`chars` integer NOT NULL,
	`lines` integer NOT NULL,
	`files` integer,
	`additions` integer,
	`deletions` integer,
	CONSTRAINT `task_attachments_pk` PRIMARY KEY(`task_id`, `position`),
	CONSTRAINT `fk_task_attachments_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
