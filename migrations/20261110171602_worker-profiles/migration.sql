-- Only the researcher, reviewer and implementer profiles remain. Security
-- reviews fold into reviewer, and the other removed profiles into implementer.
-- Saved model and instruction settings for removed profiles go.
UPDATE `tasks`
SET `body` = json_set(
  `body`,
  '$.worker_profile',
  CASE json_extract(`body`, '$.worker_profile') WHEN 'security_reviewer' THEN 'reviewer' ELSE 'implementer' END
)
WHERE json_extract(`body`, '$.worker_profile') IN ('general', 'debugger', 'test_engineer', 'refactorer', 'security_reviewer');
--> statement-breakpoint
UPDATE `user_settings`
SET `body` = json_set(
  `body`,
  '$.task.worker_profile',
  CASE json_extract(`body`, '$.task.worker_profile') WHEN 'security_reviewer' THEN 'reviewer' ELSE 'implementer' END
)
WHERE json_extract(`body`, '$.task.worker_profile') IN ('general', 'debugger', 'test_engineer', 'refactorer', 'security_reviewer');
--> statement-breakpoint
UPDATE `user_settings`
SET `body` = json_remove(
  `body`,
  '$.models.profiles.general',
  '$.models.profiles.debugger',
  '$.models.profiles.test_engineer',
  '$.models.profiles.refactorer',
  '$.models.profiles.security_reviewer',
  '$.profiles.general',
  '$.profiles.debugger',
  '$.profiles.test_engineer',
  '$.profiles.refactorer',
  '$.profiles.security_reviewer'
);
