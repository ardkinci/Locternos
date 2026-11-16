CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`user_id` text,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_server_created_idx` ON `audit_events` (`server_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_user_idx` ON `audit_events` (`user_id`);