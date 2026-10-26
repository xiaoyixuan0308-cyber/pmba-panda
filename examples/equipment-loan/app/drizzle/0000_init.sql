CREATE TABLE `agreements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`terms_version` text NOT NULL,
	`signed_at` integer NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agreements_loan_uq` ON `agreements` (`loan_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`approver_id` integer NOT NULL,
	`approver_role` text NOT NULL,
	`decision` text NOT NULL,
	`comment` text,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approver_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "approvals_reject_reason" CHECK("approvals"."decision" <> 'Reject' or ("approvals"."comment" is not null and length(trim("approvals"."comment")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_loan_role_uq` ON `approvals` (`loan_id`,`approver_role`);--> statement-breakpoint
CREATE TABLE `audit_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`action` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` integer NOT NULL,
	`before` text,
	`after` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_object_idx` ON `audit_entries` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_tag` text NOT NULL,
	`model` text NOT NULL,
	`category` text NOT NULL,
	`unit_price` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "equipment_price_positive" CHECK("equipment"."unit_price" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_asset_tag_uq` ON `equipment` (`asset_tag`);--> statement-breakpoint
CREATE TABLE `late_fees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`overdue_days` integer NOT NULL,
	`amount` integer NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "late_fees_positive" CHECK("late_fees"."overdue_days" > 0 and "late_fees"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `late_fees_loan_uq` ON `late_fees` (`loan_id`);--> statement-breakpoint
CREATE TABLE `loan_items` (
	`loan_id` integer NOT NULL,
	`equipment_id` integer NOT NULL,
	PRIMARY KEY(`loan_id`, `equipment_id`),
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loan_items_equipment_idx` ON `loan_items` (`equipment_id`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_no` text NOT NULL,
	`borrower_id` integer NOT NULL,
	`status` text DEFAULT 'Requested' NOT NULL,
	`purpose` text NOT NULL,
	`teaching` integer NOT NULL,
	`off_campus` integer NOT NULL,
	`start_date` text NOT NULL,
	`due_date` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`asset_tags_verified_at` integer,
	`check_out_date` integer,
	`return_date` text,
	`closing_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`borrower_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "loans_status_valid" CHECK(status in ('Requested', 'Waitlisted', 'Approved', 'Rejected', 'Withdrawn', 'OnLoan', 'Overdue', 'Returned')),
	CONSTRAINT "loans_dates_order" CHECK("loans"."due_date" > "loans"."start_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loans_loan_no_uq` ON `loans` (`loan_no`);--> statement-breakpoint
CREATE INDEX `loans_status_idx` ON `loans` (`status`);--> statement-breakpoint
CREATE INDEX `loans_borrower_idx` ON `loans` (`borrower_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_id` integer NOT NULL,
	`loan_id` integer,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`recipient_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`password_hash` text NOT NULL,
	`borrower_no` text,
	`borrower_type` text,
	`department` text,
	`staff_no` text,
	`staff_role` text,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "people_kind_fields" CHECK(("people"."kind" = 'borrower' and "people"."borrower_no" is not null and "people"."borrower_type" is not null and "people"."staff_role" is null)
       or ("people"."kind" = 'staff' and "people"."staff_no" is not null and "people"."staff_role" is not null and "people"."borrower_no" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_email_uq` ON `people` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_borrower_no_uq` ON `people` (`borrower_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_staff_no_uq` ON `people` (`staff_no`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
