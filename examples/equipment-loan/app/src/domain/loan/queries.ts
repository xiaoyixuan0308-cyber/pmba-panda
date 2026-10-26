/**
 * Read side. Borrowers only ever see their own loans (NFUS1 AC2, C-03);
 * phone numbers are masked for everyone but Clerk, Manager and the owner (C-01).
 */
import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { agreements, auditEntries, equipment, lateFees, loanItems, loans, notifications, people, type LoanStatus } from "@/db/schema";
import { assertCan, can } from "@/auth/permissions";
import { phoneFor } from "@/lib/privacy";
import type { Ctx } from "../context";
import { DomainError } from "../errors";
import { decisionsOf, nextApprover } from "./approvals";
import { isFreeFor } from "./availability";

const ownOnly = (ctx: Ctx): SQL | undefined => {
  if (can(ctx.actor.role, "loan.readAll")) return undefined;
  assertCan(ctx.actor.role, "loan.readOwn");
  return eq(loans.borrowerId, ctx.actor.id!);
};

/** NFUS4 AC1 — paged list with search by loan no., borrower or asset tag. */
export function listLoans(ctx: Ctx, f: { status?: LoanStatus[]; q?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(f.pageSize ?? 20, 100);
  const page = Math.max(f.page ?? 1, 1);
  const q = f.q?.trim();
  const where = and(
    ownOnly(ctx),
    f.status?.length ? inArray(loans.status, f.status) : undefined,
    q
      ? or(
          like(loans.loanNo, `%${q}%`),
          like(people.name, `%${q}%`),
          like(people.borrowerNo, `%${q}%`),
          sql`exists (select 1 from loan_items li join equipment e on e.id = li.equipment_id where li.loan_id = ${loans.id} and e.asset_tag like ${`%${q}%`})`,
        )
      : undefined,
  );
  const base = ctx.db.select({ n: sql<number>`count(*)` }).from(loans).innerJoin(people, eq(people.id, loans.borrowerId)).where(where).get();
  const rows = ctx.db
    .select({
      id: loans.id,
      loanNo: loans.loanNo,
      status: loans.status,
      startDate: loans.startDate,
      dueDate: loans.dueDate,
      submittedAt: loans.submittedAt,
      borrowerName: people.name,
      borrowerNo: people.borrowerNo,
      items: sql<string>`(select group_concat(e.asset_tag, '、') from loan_items li join equipment e on e.id = li.equipment_id where li.loan_id = ${loans.id})`,
    })
    .from(loans)
    .innerJoin(people, eq(people.id, loans.borrowerId))
    .where(where)
    .orderBy(desc(loans.submittedAt), desc(loans.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  return { total: base?.n ?? 0, page, pageSize, rows };
}

export function getLoanDetail(ctx: Ctx, loanId: number) {
  const own = ownOnly(ctx);
  const loan = ctx.db.select().from(loans).where(and(eq(loans.id, loanId), own)).get();
  if (!loan) throw new DomainError("NOT_FOUND", "找不到这张借用单。", "C-03");
  const b = ctx.db.select().from(people).where(eq(people.id, loan.borrowerId)).get()!;
  const items = ctx.db
    .select({ id: equipment.id, assetTag: equipment.assetTag, model: equipment.model, category: equipment.category, unitPrice: equipment.unitPrice })
    .from(loanItems)
    .innerJoin(equipment, eq(equipment.id, loanItems.equipmentId))
    .where(eq(loanItems.loanId, loanId))
    .all();
  const decisions = decisionsOf(ctx.db, loanId).map((d) => ({
    ...d,
    approverName: ctx.db.select({ name: people.name }).from(people).where(eq(people.id, d.approverId)).get()?.name ?? "",
  }));
  return {
    loan,
    borrower: { id: b.id, name: b.name, borrowerNo: b.borrowerNo, borrowerType: b.borrowerType, department: b.department, phone: phoneFor(ctx.actor, b.id, b.phone) },
    items,
    decisions,
    nextApprover: loan.status === "Requested" ? nextApprover(ctx.db, loan) : null,
    agreement: ctx.db.select().from(agreements).where(eq(agreements.loanId, loanId)).get() ?? null,
    lateFee: ctx.db.select().from(lateFees).where(eq(lateFees.loanId, loanId)).get() ?? null,
    // NFUS2 AC3
    history: can(ctx.actor.role, "audit.read") ? auditOf(ctx, loanId) : null,
  };
}

export function auditOf(ctx: Ctx, loanId: number) {
  assertCan(ctx.actor.role, "audit.read");
  return ctx.db
    .select({ id: auditEntries.id, action: auditEntries.action, before: auditEntries.before, after: auditEntries.after, at: auditEntries.at, actorName: people.name, objectType: auditEntries.objectType })
    .from(auditEntries)
    .leftJoin(people, eq(people.id, auditEntries.actorId))
    .where(
      or(
        and(eq(auditEntries.objectType, "Loan"), eq(auditEntries.objectId, loanId)),
        sql`(${auditEntries.objectType} = 'Agreement' and ${auditEntries.objectId} in (select id from agreements where loan_id = ${loanId}))`,
        sql`(${auditEntries.objectType} = 'LateFee' and ${auditEntries.objectId} in (select id from late_fees where loan_id = ${loanId}))`,
      ),
    )
    .orderBy(asc(auditEntries.at), asc(auditEntries.id))
    .all();
}

/** FUS4 AC4 / FUS3 — requests waiting for the viewer's role to decide. */
export function pendingApprovals(ctx: Ctx) {
  assertCan(ctx.actor.role, "loan.approve");
  return ctx.db
    .select()
    .from(loans)
    .where(eq(loans.status, "Requested"))
    .orderBy(asc(loans.submittedAt))
    .all()
    .filter((l) => nextApprover(ctx.db, l) === ctx.actor.role);
}

/** FUS8 AC3 — the waiting list, earliest submitted first. */
export function waitlist(ctx: Ctx) {
  assertCan(ctx.actor.role, "loan.review");
  return ctx.db.select().from(loans).where(eq(loans.status, "Waitlisted")).orderBy(asc(loans.submittedAt), asc(loans.id)).all();
}

/** FUS6 AC4 — the borrower's own overdue loans for the home page. */
export function myOverdueLoans(ctx: Ctx) {
  assertCan(ctx.actor.role, "loan.readOwn");
  return ctx.db.select().from(loans).where(and(eq(loans.borrowerId, ctx.actor.id!), eq(loans.status, "Overdue"))).all();
}

export function myNotifications(ctx: Ctx, limit = 50) {
  return ctx.db.select().from(notifications).where(eq(notifications.recipientId, ctx.actor.id!)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit).all();
}

/** FUS1 AC2 — equipment to choose from, with whether each is free for the period. */
export function equipmentChoices(ctx: Ctx, f: { q?: string; from?: string; to?: string; limit?: number } = {}) {
  assertCan(ctx.actor.role, "equipment.read");
  const q = f.q?.trim();
  const rows = ctx.db
    .select()
    .from(equipment)
    .where(q ? or(like(equipment.assetTag, `%${q}%`), like(equipment.model, `%${q}%`), like(equipment.category, `%${q}%`)) : undefined)
    .orderBy(asc(equipment.assetTag))
    .limit(f.limit ?? 50)
    .all();
  return rows.map((e) => ({ ...e, freeForPeriod: f.from && f.to ? isFreeFor(ctx.db, ctx.today, e.id, f.from, f.to) : null }));
}

type LoanWithBorrower = typeof loans.$inferSelect & { borrowerName: string; borrowerNo: string | null; items: string };
function withBorrower(ctx: Ctx, where: SQL | undefined, order: SQL[]): LoanWithBorrower[] {
  return ctx.db
    .select({
      loan: loans,
      borrowerName: people.name,
      borrowerNo: people.borrowerNo,
      items: sql<string>`(select group_concat(e.asset_tag, '、') from loan_items li join equipment e on e.id = li.equipment_id where li.loan_id = ${loans.id})`,
    })
    .from(loans)
    .innerJoin(people, eq(people.id, loans.borrowerId))
    .where(where)
    .orderBy(...order)
    .all()
    .map((r) => ({ ...r.loan, borrowerName: r.borrowerName, borrowerNo: r.borrowerNo, items: r.items }));
}

/** Clerk's home (01-role-views.md): today's pick-ups and returns. */
export function counterToday(ctx: Ctx) {
  if (!can(ctx.actor.role, "loan.checkOut") && !can(ctx.actor.role, "loan.return")) assertCan(ctx.actor.role, "loan.checkOut");
  const signed = new Set(ctx.db.select({ loanId: agreements.loanId }).from(agreements).all().map((a) => a.loanId));
  const pickups = withBorrower(ctx, and(eq(loans.status, "Approved"), sql`${loans.startDate} <= ${ctx.today}`), [asc(loans.startDate), asc(loans.id)]).map((l) => ({ ...l, agreementSigned: signed.has(l.id) }));
  const returns = withBorrower(ctx, or(eq(loans.status, "Overdue"), and(eq(loans.status, "OnLoan"), sql`${loans.dueDate} <= ${ctx.today}`)), [asc(loans.dueDate), asc(loans.id)]);
  return { pickups, returns };
}

/** Manager's home: overdue loans to chase (FUS6). */
export function overdueList(ctx: Ctx) {
  assertCan(ctx.actor.role, "loan.readAll");
  return withBorrower(ctx, eq(loans.status, "Overdue"), [asc(loans.dueDate)]);
}

/** Lists for the home pages, with borrower names. */
export function pendingApprovalsDetailed(ctx: Ctx) {
  const ids = pendingApprovals(ctx).map((l) => l.id);
  return ids.length ? withBorrower(ctx, inArray(loans.id, ids), [asc(loans.submittedAt)]) : [];
}
export function waitlistDetailed(ctx: Ctx) {
  assertCan(ctx.actor.role, "loan.review");
  return withBorrower(ctx, eq(loans.status, "Waitlisted"), [asc(loans.submittedAt), asc(loans.id)]);
}
export function myLoans(ctx: Ctx) {
  assertCan(ctx.actor.role, "loan.readOwn");
  return withBorrower(ctx, eq(loans.borrowerId, ctx.actor.id!), [desc(loans.submittedAt), desc(loans.id)]);
}

export function markNotificationsRead(ctx: Ctx) {
  ctx.db.update(notifications).set({ readAt: ctx.now }).where(and(eq(notifications.recipientId, ctx.actor.id!), sql`${notifications.readAt} is null`)).run();
}
