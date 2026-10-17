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
