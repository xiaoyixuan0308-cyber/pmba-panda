-- NFUS2 AC2: the audit trail is append-only, enforced by the database itself.
CREATE TRIGGER `audit_entries_no_update` BEFORE UPDATE ON `audit_entries`
BEGIN SELECT RAISE(ABORT, 'audit_entries is append-only (NFUS2)'); END;
--> statement-breakpoint
CREATE TRIGGER `audit_entries_no_delete` BEFORE DELETE ON `audit_entries`
BEGIN SELECT RAISE(ABORT, 'audit_entries is append-only (NFUS2)'); END;
--> statement-breakpoint
-- C-02 / NFUS6 AC1: loans are never deleted (withdraw or cancel instead).
CREATE TRIGGER `loans_no_delete` BEFORE DELETE ON `loans`
BEGIN SELECT RAISE(ABORT, 'loans are never deleted (C-02)'); END;
