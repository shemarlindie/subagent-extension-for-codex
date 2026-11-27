-- Updates the parent hasn't seen stay pending, and a request only while it is
-- its task's current one.
INSERT INTO `task_parent_pending` (`event_id`, `task_id`, `request_id`)
SELECT
	e.`id`,
	e.`task_id`,
	CASE
		WHEN e.`type` = 'agent.input_required' THEN json_extract(e.`data`, '$.request.id')
	END
FROM `events` e
JOIN `tasks` t ON t.`id` = e.`task_id`
WHERE e.`type` IN ('agent.reply', 'task.failed', 'agent.input_required')
	AND NOT EXISTS (
		SELECT 1 FROM `task_parent_seen` s WHERE s.`event_id` = e.`id`
	)
	AND (
		e.`type` <> 'agent.input_required'
		OR json_extract(e.`data`, '$.request.id') = json_extract(t.`body`, '$.pending_input.id')
	);
