CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`project_id` text,
	`version_id` text,
	`sha256` text NOT NULL,
	`installed_at` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_server_kind_idx` ON `artifacts` (`server_id`,`kind`);