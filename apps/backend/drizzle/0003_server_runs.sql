CREATE TABLE `server_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`pid` integer,
	`started_at` text NOT NULL,
	`stopped_at` text,
	`exit_code` integer,
	`stop_reason` text,
	`peak_ram_mb` integer,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_runs_server_started_idx` ON `server_runs` (`server_id`,`started_at`);