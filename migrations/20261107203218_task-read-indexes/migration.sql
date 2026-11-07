ALTER TABLE `events` ADD `chat` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `status` text GENERATED ALWAYS AS (json_extract(body, '$.status')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `created_at` text GENERATED ALWAYS AS (json_extract(body, '$.created_at')) VIRTUAL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `conversation_id` text GENERATED ALWAYS AS (json_extract(body, '$.conversation_id')) VIRTUAL;--> statement-breakpoint
CREATE INDEX `events_task_type` ON `events` (`task_id`,`type`,`id`);--> statement-breakpoint
CREATE INDEX `events_task_chat` ON `events` (`task_id`,`chat`,`id`);--> statement-breakpoint
CREATE INDEX `tasks_owner_created` ON `tasks` (`owner`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_owner_conversation` ON `tasks` (`owner`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_status` ON `tasks` (`status`);