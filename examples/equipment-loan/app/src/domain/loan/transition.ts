/**
 * The single place where a loan's status changes
 * (references/uml-to-code-mapping.md section 3.2).
 *
 * applyTransition() runs, inside the caller's transaction:
 *   check current state → check role → check guards → exit action →
 *   change status → effects → entry action → audit entry.
 * Any failure throws a DomainError and the whole transaction rolls back.
 */
import { and, asc, eq, isNull, like } from "drizzle-orm";
import { approvals, lateFees, loanItems, loans, notifications, people, type LoanStatus, type StaffRole } from "@/db/schema";
import { daysBetween } from "@/lib/dates";
import { notify, writeAudit, type Tx } from "../audit";
import { SYSTEM, type Ctx } from "../context";
import { DomainError } from "../errors";
import { STATUS_LABEL, yuan } from "../labels";
import { getNumber } from "../settings";
import { nextApprover } from "./approvals";
import { shortItems } from "./availability";
import { GUARDS, type GuardInput } from "./guards";
import { ENTRY, EXIT, TRANSITIONS, type Transition, type TransitionId } from "./transitions";

type LoanRow = typeof loans.$inferSelect;
export interface TransitionInput extends GuardInput {
  /** T10: the borrower has paid the late fee at the counter (BR-10, change 002). */
  feePaid?: boolean;
}

export const OVERDUE_ALERT_PREFIX = "【逾期提醒】";

export function loadLoan(tx: Tx, loanId: number): LoanRow {
  const loan = tx.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) throw new DomainError("NOT_FOUND", "找不到这张借用单。");
  return loan;
}

export const staffWithRole = (tx: Tx, role: StaffRole) =>
  tx.select({ id: people.id }).from(people).where(eq(people.staffRole, role)).all().map((p) => p.id);

/** BR-10: late fee for a return on `today`. */
export function lateFeeFor(ctx: Ctx, dueDate: string) {
  const overdueDays = Math.max(0, daysBetween(dueDate, ctx.today));
  const perDay = getNumber(ctx.db, "lateFeePerDay");
  const cap = getNumber(ctx.db, "lateFeeCap");
  return { overdueDays, perDay, cap, amount: Math.min(overdueDays * perDay, cap), capped: overdueDays * perDay > cap };
}

function checkAllowed(t: Transition, ctx: Ctx, loan: LoanRow) {
  if (loan.status !== t.from) {
    throw new DomainError(
      "INVALID_STATE",
      `借用单 ${loan.loanNo} 当前为"${STATUS_LABEL[loan.status]}"，不能${t.label}。`,
      t.rules[0],
    );
  }
  if (!t.roles.includes(ctx.actor.role)) {
    throw new DomainError("FORBIDDEN", `你的角色不能${t.label}这张借用单。`, "NFUS1");
  }
  if (t.own && loan.borrowerId !== ctx.actor.id) {
    throw new DomainError("NOT_FOUND", "找不到这张借用单。", "C-03");
  }
}

export function applyTransition(tx: Tx, ctx: Ctx, loanId: number, id: TransitionId, input: TransitionInput = {}): LoanRow {
  const t = TRANSITIONS[id];
  const loan = loadLoan(tx, loanId);
  checkAllowed(t, ctx, loan);

  for (const g of t.guards) {
    const failure = GUARDS[g](tx, ctx, loan, input);
    if (failure) throw new DomainError("GUARD_FAILED", failure.message, failure.rule);
  }
  if (t.effects.includes("chargeLateFee") && !input.feePaid) {
    const fee = lateFeeFor(ctx, loan.dueDate);
    throw new DomainError("GUARD_FAILED", `请先收取逾期费 ${yuan(fee.amount)} 元，再办理归还。`, "BR-10");
  }

  runExit(tx, ctx, loan);

  // the only status write in the application
  const patch: Partial<LoanRow> = { status: t.to };
  if (t.effects.includes("recordCheckOutDate")) patch.checkOutDate = ctx.now;
  if (t.effects.includes("recordReturnDate")) patch.returnDate = ctx.today;
  if (id === "T11") patch.closingReason = input.reason!.trim();
  const changed = tx
    .update(loans)
    .set(patch)
    .where(and(eq(loans.id, loan.id), eq(loans.status, t.from)))
    .run();
  if (changed.changes !== 1) throw new DomainError("INVALID_STATE", "借用单刚被其他人处理过，请刷新后再试。");
  const after = loadLoan(tx, loan.id);

  writeAudit(tx, ctx, { action: `${t.id} ${t.trigger}`, objectId: loan.id, before: t.from, after: t.to });
  runEffects(tx, ctx, t, after, input);
  runEntry(tx, ctx, after);
  if (t.effects.includes("releaseEquipment")) releaseWaiting(tx, ctx);
  return after;
}

function runEffects(tx: Tx, ctx: Ctx, t: Transition, loan: LoanRow, input: TransitionInput) {
  for (const e of t.effects) {
    switch (e) {
      case "recordReason":
        if (t.id === "T4") {
          tx.insert(approvals)
            .values({ loanId: loan.id, approverId: ctx.actor.id!, approverRole: ctx.actor.role as StaffRole, decision: "Reject", comment: input.reason!.trim(), decidedAt: ctx.now })
            .run();
        }
        break;
      case "notifyBorrower": {
        const msg =
          t.id === "T3" ? `你的借用单 ${loan.loanNo} 已批准。请在系统中签署借用协议，并在借用日期到设备室领取设备。`
          : t.id === "T4" ? `你的借用单 ${loan.loanNo} 未获批准。原因：${input.reason!.trim()}`
          : `你的借用单 ${loan.loanNo} 已被设备管理员取消。原因：${input.reason!.trim()}`;
        notify(tx, ctx, loan.borrowerId, msg, loan.id);
        break;
      }
      case "chargeLateFee": {
        const fee = lateFeeFor(ctx, loan.dueDate);
        if (fee.overdueDays > 0) {
          const row = tx.insert(lateFees).values({ loanId: loan.id, overdueDays: fee.overdueDays, amount: fee.amount, paidAt: ctx.now }).returning().get();
          writeAudit(tx, ctx, { action: "chargeLateFee", objectType: "LateFee", objectId: row.id, after: `逾期 ${fee.overdueDays} 天，收取 ${yuan(fee.amount)} 元（已缴）` });
        }
        break;
      }
      // recordCheckOutDate / recordReturnDate are written with the status;
      // releaseEquipment runs after the entry action (releaseWaiting).
    }
  }
}

function runEntry(tx: Tx, ctx: Ctx, loan: LoanRow) {
  switch (ENTRY[loan.status]) {
    case "notifyApprovers": {
      const role = nextApprover(tx, loan) ?? "Manager";
      for (const id of staffWithRole(tx, role)) notify(tx, ctx, id, `借用单 ${loan.loanNo} 等待你审批。`, loan.id);
      break;
    }
    case "notifyBorrower":
      notify(tx, ctx, loan.borrowerId, `你的借用单 ${loan.loanNo} 申请的设备在借用期间不足，已进入等待名单。有设备空出时会重新审核。`, loan.id);
      break;
    case "notifyBorrowerAndManager":
      notify(tx, ctx, loan.borrowerId, `${OVERDUE_ALERT_PREFIX}你的借用单 ${loan.loanNo} 已过应还日期 ${loan.dueDate}，请尽快归还。逾期费每天 ${yuan(getNumber(ctx.db, "lateFeePerDay"))} 元。`, loan.id);
      for (const id of staffWithRole(tx, "Manager")) notify(tx, ctx, id, `${OVERDUE_ALERT_PREFIX}借用单 ${loan.loanNo} 已逾期（应还 ${loan.dueDate}）。`, loan.id);
      break;
  }
}

function runExit(tx: Tx, ctx: Ctx, loan: LoanRow) {
  if (EXIT[loan.status] === "closeOverdueAlert") {
    tx.update(notifications)
      .set({ readAt: ctx.now })
      .where(and(eq(notifications.loanId, loan.id), like(notifications.message, `${OVERDUE_ALERT_PREFIX}%`), isNull(notifications.readAt)))
      .run();
  }
}

/** Entry action for a newly submitted loan ([*] → Requested). */
export function enterInitialState(tx: Tx, ctx: Ctx, loanId: number) {
  runEntry(tx, ctx, loadLoan(tx, loanId));
}

/**
 * T2 (BR-03, FUS8): after equipment is freed, waiting loans whose equipment is
 * now available go back to Requested, earliest submitted first. A piece of
 * equipment is offered to one waiting loan per release.
 */
export function releaseWaiting(tx: Tx, ctx: Ctx) {
  const sys: Ctx = { ...ctx, actor: SYSTEM };
  const waiting = tx.select().from(loans).where(eq(loans.status, "Waitlisted")).orderBy(asc(loans.submittedAt), asc(loans.id)).all();
  const offered = new Set<number>();
  const released: string[] = [];
  for (const w of waiting) {
    const items = tx.select({ id: loanItems.equipmentId }).from(loanItems).where(eq(loanItems.loanId, w.id)).all().map((i) => i.id);
    if (items.some((i) => offered.has(i))) continue;
    if (shortItems(tx, ctx.today, w.id).length > 0) continue;
    applyTransition(tx, sys, w.id, "T2");
    items.forEach((i) => offered.add(i));
    released.push(w.loanNo);
  }
  return released;
}

export type { LoanStatus };
