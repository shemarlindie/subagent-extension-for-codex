CREATE TABLE `task_messages` (
	`task_id` text NOT NULL,
	`seq` integer NOT NULL,
	`message_id` text NOT NULL,
	`message` text NOT NULL,
	`sender` text NOT NULL,
	CONSTRAINT `task_messages_pk` PRIMARY KEY(`task_id`, `seq`),
	CONSTRAINT `fk_task_messages_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
