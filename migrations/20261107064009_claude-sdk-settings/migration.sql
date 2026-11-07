-- Claude settings become SDK options: either extension sandbox preset turns the
-- sandbox toggle on, `user_config` turns it off, and the `tools` and
-- `path_guard` settings go. A task keeps its options under its provider's key.
UPDATE `user_settings`
SET `body` = json_set(
  `body`,
  '$.providers.claude.sandbox',
  json(CASE json_extract(`body`, '$.providers.claude.sandbox') WHEN 'user_config' THEN 'false' ELSE 'true' END)
)
WHERE json_type(`body`, '$.providers.claude.sandbox') = 'text';
--> statement-breakpoint
UPDATE `user_settings`
SET `body` = json_remove(`body`, '$.providers.claude.tools', '$.providers.claude.path_guard')
WHERE json_type(`body`, '$.providers.claude') = 'object';
--> statement-breakpoint
-- Read-only profile tasks the removed restrictions limited move to plan mode.
UPDATE `tasks`
SET `body` = json_set(
  `body`,
  '$.provider_options."' || json_extract(`body`, '$.provider') || '".permission_mode',
  'plan'
)
WHERE json_extract(`body`, '$.worker_profile') IN ('researcher', 'reviewer', 'security_reviewer')
  AND (
    json_extract(`body`, '$.provider_options."' || json_extract(`body`, '$.provider') || '".claude_policy.tools') = 'restricted'
    OR json_extract(`body`, '$.provider_options."' || json_extract(`body`, '$.provider') || '".claude_policy.path_guard') = 1
  );
--> statement-breakpoint
UPDATE `tasks`
SET `body` = json_remove(
  json_set(
    `body`,
    '$.provider_options."' || json_extract(`body`, '$.provider') || '".claude_policy.sandbox',
    json(CASE json_extract(`body`, '$.provider_options."' || json_extract(`body`, '$.provider') || '".claude_policy.sandbox') WHEN 'user_config' THEN 'false' ELSE 'true' END)
  ),
  '$.provider_options."' || json_extract(`body`, '$.provider') || '".claude_policy.tools',
  '$.provider_options."' || json_extract(`body`, '$.provider') || '".claude_policy.path_guard'
)
WHERE json_type(`body`, '$.provider_options."' || json_extract(`body`, '$.provider') || '".claude_policy.sandbox') = 'text';
