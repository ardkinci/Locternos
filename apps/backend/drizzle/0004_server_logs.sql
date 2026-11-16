CREATE TABLE `server_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`server_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`level` text NOT NULL,
	`thread` text,
	`message` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `server_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_logs_server_timestamp_idx` ON `server_logs` (`server_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `server_logs_run_idx` ON `server_logs` (`run_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `server_logs_fts` USING fts5(
	`message`,
	content='server_logs',
	content_rowid='id',
	tokenize='unicode61'
);
--> statement-breakpoint
CREATE TRIGGER `server_logs_fts_ai` AFTER INSERT ON `server_logs` BEGIN
	INSERT INTO `server_logs_fts`(`rowid`, `message`) VALUES (new.`id`, new.`message`);
END;
--> statement-breakpoint
CREATE TRIGGER `server_logs_fts_ad` AFTER DELETE ON `server_logs` BEGIN
	INSERT INTO `server_logs_fts`(`server_logs_fts`, `rowid`, `message`)
	VALUES ('delete', old.`id`, old.`message`);
END;
--> statement-breakpoint
CREATE TRIGGER `server_logs_fts_au` AFTER UPDATE ON `server_logs` BEGIN
	INSERT INTO `server_logs_fts`(`server_logs_fts`, `rowid`, `message`)
	VALUES ('delete', old.`id`, old.`message`);
	INSERT INTO `server_logs_fts`(`rowid`, `message`) VALUES (new.`id`, new.`message`);
END;
