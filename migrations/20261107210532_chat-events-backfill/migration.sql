-- Marks the events Chat shows, as `isChatEvent` does for new events: those of
-- `CHAT_EVENTS` and context compactions among Claude's activity.
UPDATE `events`
SET `chat` = 1
WHERE `type` IN (
    'task.started',
    'task.instruction',
    'agent.message',
    'agent.reply',
    'task.turn_ended',
    'task.failed',
    'task.session_started',
    'task.worktree_recreated',
    'agent.limited',
    'agent.input_required'
  )
  OR (
    `type` = 'claude.activity'
    AND (
      json_extract(`data`, '$.subtype') = 'compact_boundary'
      OR json_extract(`data`, '$.compact_result') = 'failed'
    )
  );
