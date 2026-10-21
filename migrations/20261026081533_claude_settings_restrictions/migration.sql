-- Claude tasks started before these restrictions loaded settings files and
-- their MCP servers, so they keep doing so.
UPDATE `tasks`
SET `body` = json_insert(
  `body`,
  '$.provider_options.claude.claude_policy.settings_files', json('true'),
  '$.provider_options.claude.claude_policy.user_mcp', json('true')
)
WHERE json_type(`body`, '$.provider_options.claude.claude_policy') = 'object';
