CREATE TABLE `task_seen` (
	`task_id` text PRIMARY KEY,
	`through` integer NOT NULL,
	`unseen` integer NOT NULL,
	CONSTRAINT `fk_task_seen_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- Tasks from before seen tracking start seen through their newest event.
INSERT INTO `task_seen` (`task_id`, `through`, `unseen`)
SELECT `tasks`.`id`, COALESCE(MAX(`events`.`id`), 0), 0
FROM `tasks` LEFT JOIN `events` ON `events`.`task_id` = `tasks`.`id`
GROUP BY `tasks`.`id`;
