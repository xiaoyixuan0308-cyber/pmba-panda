/**
 * Database schema — derived from spec/models/07-class-domain.puml
 * (mapping rules: references/uml-to-code-mapping.md section 2).
 *
 * Conventions (references/default-stack.md):
 * - Names come from spec/glossary.md.
 * - Money is stored as integer cents.
 * - Date-only fields (startDate, dueDate, returnDate) are 'YYYY-MM-DD' text;
 *   fields with a time of day are UTC timestamps.
 * - Nothing is ever deleted (C-02): there are no delete operations in the app.
 */
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/sqlite-core";

const ts = (name: string) => integer(name, { mode: "timestamp" });
const bool = (name: string) => integer(name, { mode: "boolean" });
const created = () => ts("created_at").notNull().default(sql`(unixepoch())`);

/** Values must match the enums in the class diagram and the state machine. */
export const LOAN_STATUSES = [
  "Requested",
  "Waitlisted",
  "Approved",
  "Rejected",
  "Withdrawn",
  "OnLoan",
  "Overdue",
  "Returned",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const BORROWER_TYPES = ["Student", "Teacher"] as const;
export type BorrowerType = (typeof BORROWER_TYPES)[number];

export const STAFF_ROLES = ["Clerk", "Manager", "DeptHead"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const APPROVAL_DECISIONS = ["Approve", "Reject"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(", ")})`);

/**
 * Person, Borrower and StaffMember (generalisation) — single table with a
 * `kind` discriminator (build plan section 1).
 */
export const people = sqliteTable(
  "people",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["borrower", "staff"] }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    passwordHash: text("password_hash").notNull(),
    // Borrower
    borrowerNo: text("borrower_no"),
    borrowerType: text("borrower_type", { enum: BORROWER_TYPES }),
    department: text("department"),
    // StaffMember
    staffNo: text("staff_no"),
    staffRole: text("staff_role", { enum: STAFF_ROLES }),
    // NFUS1 AC3: lock after 5 failed logins
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("people_email_uq").on(t.email),
    uniqueIndex("people_borrower_no_uq").on(t.borrowerNo),
    uniqueIndex("people_staff_no_uq").on(t.staffNo),
    check(
      "people_kind_fields",
      sql`(${t.kind} = 'borrower' and ${t.borrowerNo} is not null and ${t.borrowerType} is not null and ${t.staffRole} is null)
       or (${t.kind} = 'staff' and ${t.staffNo} is not null and ${t.staffRole} is not null and ${t.borrowerNo} is null)`,
    ),
  ],
);

export const equipment = sqliteTable(
  "equipment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assetTag: text("asset_tag").notNull(),
    model: text("model").notNull(),
    category: text("category").notNull(),
    /** cents; valuable = unitPrice > 500000 (DT-01, derived, not stored) */
    unitPrice: integer("unit_price").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("equipment_asset_tag_uq").on(t.assetTag),
    check("equipment_price_positive", sql`${t.unitPrice} > 0`),
  ],
);

export const loans = sqliteTable(
  "loans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanNo: text("loan_no").notNull(),
    borrowerId: integer("borrower_id")
      .notNull()
      .references(() => people.id),
    status: text("status", { enum: LOAN_STATUSES }).notNull().default("Requested"),
    purpose: text("purpose").notNull(),
    teaching: bool("teaching").notNull(),
    offCampus: bool("off_campus").notNull(),
    startDate: text("start_date").notNull(),
    dueDate: text("due_date").notNull(),
    submittedAt: ts("submitted_at").notNull(),
    assetTagsVerifiedAt: ts("asset_tags_verified_at"),
    checkOutDate: ts("check_out_date"),
    returnDate: text("return_date"),
    /** change 001: required when a Manager cancels an approved loan (T11) */
    closingReason: text("closing_reason"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("loans_loan_no_uq").on(t.loanNo),
    index("loans_status_idx").on(t.status),
    index("loans_borrower_idx").on(t.borrowerId),
    check("loans_status_valid", inList("status", LOAN_STATUSES)),
    check("loans_dates_order", sql`${t.dueDate} > ${t.startDate}`),
  ],
);

/** Loan "0..*" o-- "1..*" Equipment — aggregation, association table. */
export const loanItems = sqliteTable(
  "loan_items",
  {
    loanId: integer("loan_id")
      .notNull()
      .references(() => loans.id),
    equipmentId: integer("equipment_id")
      .notNull()
      .references(() => equipment.id),
  },
  (t) => [
    primaryKey({ columns: [t.loanId, t.equipmentId] }),
    index("loan_items_equipment_idx").on(t.equipmentId),
  ],
);

/** Loan "1" *-- "0..*" Approval — composition. */
export const approvals = sqliteTable(
  "approvals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    approverId: integer("approver_id")
      .notNull()
      .references(() => people.id),
    approverRole: text("approver_role", { enum: STAFF_ROLES }).notNull(),
    decision: text("decision", { enum: APPROVAL_DECISIONS }).notNull(),
    comment: text("comment"),
    decidedAt: ts("decided_at").notNull(),
  },
  (t) => [
    uniqueIndex("approvals_loan_role_uq").on(t.loanId, t.approverRole),
    // BR-04: a rejection must carry a reason
    check(
      "approvals_reject_reason",
      sql`${t.decision} <> 'Reject' or (${t.comment} is not null and length(trim(${t.comment})) > 0)`,
    ),
  ],
);

/** Loan "1" *-- "0..1" Agreement — composition. */
export const agreements = sqliteTable(
  "agreements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    termsVersion: text("terms_version").notNull(),
    signedAt: ts("signed_at").notNull(),
  },
  (t) => [uniqueIndex("agreements_loan_uq").on(t.loanId)],
);

/** Loan "1" *-- "0..1" LateFee — composition. */
export const lateFees = sqliteTable(
  "late_fees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    overdueDays: integer("overdue_days").notNull(),
    /** cents */
    amount: integer("amount").notNull(),
    paidAt: ts("paid_at"),
  },
  (t) => [
    uniqueIndex("late_fees_loan_uq").on(t.loanId),
    check("late_fees_positive", sql`${t.overdueDays} > 0 and ${t.amount} > 0`),
  ],
);

/** Insert-only (NFUS2). actorId is null for system actions. */
export const auditEntries = sqliteTable(
  "audit_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: integer("actor_id").references(() => people.id),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: integer("object_id").notNull(),
    before: text("before"),
    after: text("after"),
    at: ts("at").notNull(),
  },
  (t) => [index("audit_object_idx").on(t.objectType, t.objectId)],
);

/** change 001 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => people.id),
    loanId: integer("loan_id").references(() => loans.id),
    message: text("message").notNull(),
    createdAt: ts("created_at").notNull(),
    readAt: ts("read_at"),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientId)],
);

/** NFUS6 AC2 and demo controls (build plan section 4). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
