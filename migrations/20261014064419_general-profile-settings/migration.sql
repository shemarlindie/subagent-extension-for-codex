-- Settings saved before the General profile existed lack its model defaults.
UPDATE `user_settings`
SET `body` = json_insert(
  `body`,
  '$.general_default_model', '',
  '$.general_default_reasoning_effort', 'default'
);
