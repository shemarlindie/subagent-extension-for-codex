CREATE TABLE `task_read` (
	`task_id` text PRIMARY KEY,
	`through` integer NOT NULL,
	`unread` integer NOT NULL,
	CONSTRAINT `fk_task_read_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- Tasks from before read tracking start read through their newest event.
INSERT INTO `task_read` (`task_id`, `through`, `unread`)
SELECT `tasks`.`id`, COALESCE(MAX(`events`.`id`), 0), 0
FROM `tasks` LEFT JOIN `events` ON `events`.`task_id` = `tasks`.`id`
GROUP BY `tasks`.`id`;
