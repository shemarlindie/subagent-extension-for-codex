ALTER TABLE `events` ADD `response_ref` text;--> statement-breakpoint
ALTER TABLE `events` ADD `original_response` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_response` ON `events` (`response_ref`);