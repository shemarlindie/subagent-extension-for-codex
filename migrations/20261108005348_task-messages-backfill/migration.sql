-- Moves each task's delivered messages from its body's `instructions` array
-- into `task_messages`, keeping their order, and removes the array.
INSERT INTO `task_messages` (`task_id`, `seq`, `message_id`, `message`, `sender`)
SELECT
  `tasks`.`id`,
  `m`.`key`,
  json_extract(`m`.`value`, '$.id'),
  json_extract(`m`.`value`, '$.message'),
  json_extract(`m`.`value`, '$.from')
FROM `tasks`, json_each(`tasks`.`body`, '$.instructions') AS `m`;
--> statement-breakpoint
UPDATE `tasks`
SET `body` = json_remove(`body`, '$.instructions')
WHERE json_type(`body`, '$.instructions') IS NOT NULL;
