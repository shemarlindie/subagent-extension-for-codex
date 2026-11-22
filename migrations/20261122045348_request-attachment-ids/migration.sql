-- Request attachments take the request's id, so the next migration can key every attachment by its message.
UPDATE `task_attachments` SET `message_id` = 'request' WHERE `message_id` IS NULL;
