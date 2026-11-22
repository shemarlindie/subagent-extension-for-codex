PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_attachments` (
	`task_id` text NOT NULL,
	`message_id` text NOT NULL,
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
	`paths` text,
	`start_line` integer,
	`end_line` integer,
	CONSTRAINT `task_attachments_pk` PRIMARY KEY(`task_id`, `message_id`, `position`),
	CONSTRAINT `fk_task_attachments_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_task_attachments`(`task_id`, `position`, `message_id`, `title`, `summary`, `format`, `path`, `source`, `file`, `chars`, `lines`, `files`, `additions`, `deletions`, `paths`, `start_line`, `end_line`) SELECT `task_id`, `position`, `message_id`, `title`, `summary`, `format`, `path`, `source`, `file`, `chars`, `lines`, `files`, `additions`, `deletions`, `paths`, `start_line`, `end_line` FROM `task_attachments`;--> statement-breakpoint
DROP TABLE `task_attachments`;--> statement-breakpoint
ALTER TABLE `__new_task_attachments` RENAME TO `task_attachments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;