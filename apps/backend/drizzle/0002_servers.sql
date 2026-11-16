CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`core_type` text NOT NULL,
	`mc_version` text,
	`entrypoint_jar` text DEFAULT '' NOT NULL,
	`java_path` text,
	`min_ram_mb` integer NOT NULL,
	`max_ram_mb` integer NOT NULL,
	`jvm_flags_profile` text DEFAULT 'default' NOT NULL,
	`custom_jvm_args` text DEFAULT '' NOT NULL,
	`port` integer NOT NULL,
	`log_retention_policy` text DEFAULT '7d' NOT NULL,
	`eula_accepted_at` text,
	`status` text DEFAULT 'stopped' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_slug_unique` ON `servers` (`slug`);