-- Normal mode no longer stores original responses. Older events kept one inline.
UPDATE `events` SET `data` = json_remove(`data`, '$.raw_response')
WHERE json_type(`data`, '$.raw_response') IS NOT NULL;--> statement-breakpoint
-- File tool events keep paths, options and errors without file contents.
-- Events recorded with full events, which carry a response_ref, keep theirs.
CREATE TEMP TABLE `file_tool_calls` (
	`task_id` text NOT NULL,
	`tool_id` text NOT NULL,
	PRIMARY KEY (`task_id`, `tool_id`)
) WITHOUT ROWID;--> statement-breakpoint
INSERT OR IGNORE INTO `file_tool_calls`
SELECT `task_id`, json_extract(`data`, '$.id') FROM `events`
WHERE `type` = 'tool.started'
	AND json_extract(`data`, '$.name') IN ('Read', 'Write', 'Edit', 'NotebookEdit')
	AND json_type(`data`, '$.id') = 'text'
	AND json_type(`data`, '$.response_ref') IS NULL;--> statement-breakpoint
UPDATE `events` SET `data` = json_remove(
	`data`,
	'$.input.content',
	'$.input.old_string',
	'$.input.new_string',
	'$.input.new_source'
)
WHERE (
		(`type` = 'tool.started' AND json_extract(`data`, '$.name') IN ('Read', 'Write', 'Edit', 'NotebookEdit'))
		OR (`type` = 'agent.permission_decided' AND json_extract(`data`, '$.tool') IN ('Read', 'Write', 'Edit', 'NotebookEdit'))
	)
	AND json_type(`data`, '$.response_ref') IS NULL;--> statement-breakpoint
UPDATE `events` SET `data` = json_set(`data`, '$.content', 'File content isn''t stored.')
WHERE `type` = 'tool.completed'
	AND json_extract(`data`, '$.error') IS NOT 1
	AND json_type(`data`, '$.response_ref') IS NULL
	AND EXISTS (
		SELECT 1 FROM `file_tool_calls`
		WHERE `file_tool_calls`.`task_id` = `events`.`task_id`
			AND `file_tool_calls`.`tool_id` = json_extract(`events`.`data`, '$.id')
	);--> statement-breakpoint
DROP TABLE `file_tool_calls`;
