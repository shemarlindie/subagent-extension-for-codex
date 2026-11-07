-- `start_task` drops `context`. A task's excerpts join its description with
-- blank lines, as the worker prompt joined them, and the field goes.
UPDATE `tasks`
SET `body` = json_set(
  `body`,
  '$.description',
  json_extract(`body`, '$.description') || (
    SELECT group_concat(char(10) || char(10) || `value`, '' ORDER BY `key`)
    FROM json_each(`body`, '$.context')
  )
)
WHERE json_array_length(`body`, '$.context') > 0;
--> statement-breakpoint
UPDATE `tasks`
SET `body` = json_remove(`body`, '$.context')
WHERE json_type(`body`, '$.context') IS NOT NULL;
