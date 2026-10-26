/**
 * The daily check (build plan section 4): run from the Manager's page with the
 * simulated date; production replaces the button with a scheduled job.
 *   1. T8  — OnLoan past its due date → Overdue (BR-07)
 *   2. BR-09 — remind approvers of requests waiting ≥ N working days
 *   3. OnLoan "do / remindBeforeDue" — remind the borrower the day before the
 *      due date. One day before the due date (01-rules.md, user clarification in 5b).
 * Running it twice on the same day sends nothing new.
 */
import { and, eq, lt } from "drizzle-orm";
import { loans, notifications } from "@/db/schema";
import { assertCan } from "@/auth/permissions";
import { addDays, localDateOf, workingDaysBetween } from "@/lib/dates";
import { notify, type Tx } from "../audit";
import { SYSTEM, type Ctx } from "../context";
import { STAFF_ROLE_LABEL } from "../labels";
import { getNumber } from "../settings";
import { nextApprover } from "./approvals";
import { applyTransition, staffWithRole } from "./transition";

export const APPROVAL_REMINDER_PREFIX = "【审批提醒】";
export const DUE_REMINDER_PREFIX = "【到期提醒】";

function alreadySentToday(tx: Tx, ctx: Ctx, loanId: number, recipientId: number, prefix: string) {
  return tx
    .select({ message: notifications.message, createdAt: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.loanId, loanId), eq(notifications.recipientId, recipientId)))
    .all()
    .some((n) => n.message.startsWith(prefix) && localDateOf(n.createdAt) === ctx.today);
}

export function runDailyChecks(ctx: Ctx) {
  assertCan(ctx.actor.role, "loan.runDailyChecks");
  const sys: Ctx = { ...ctx, actor: SYSTEM };
  return ctx.db.transaction((tx) => {
    // 1. BR-07
    const expired: string[] = [];
    for (const l of tx.select().from(loans).where(and(eq(loans.status, "OnLoan"), lt(loans.dueDate, ctx.today))).all()) {
      applyTransition(tx, sys, l.id, "T8");
      expired.push(l.loanNo);
    }

    // 2. BR-09 — only the approver whose turn it is (DT-01, E07)
    const n = getNumber(ctx.db, "reminderWorkingDays");
    const reminded: string[] = [];
    for (const l of tx.select().from(loans).where(eq(loans.status, "Requested")).all()) {
      if (workingDaysBetween(localDateOf(l.submittedAt), ctx.today) < n) continue;
      const role = nextApprover(tx, l);
      if (!role) continue;
      for (const id of staffWithRole(tx, role)) {
        if (alreadySentToday(tx, ctx, l.id, id, APPROVAL_REMINDER_PREFIX)) continue;
        notify(tx, sys, id, `${APPROVAL_REMINDER_PREFIX}借用单 ${l.loanNo} 已提交超过 ${n} 个工作日，等待${STAFF_ROLE_LABEL[role]}审批。`, l.id);
        reminded.push(`${l.loanNo}→${STAFF_ROLE_LABEL[role]}`);
      }
    }

    // 3. remindBeforeDue (01-rules.md 说明)
    const dueSoon: string[] = [];
    const tomorrow = addDays(ctx.today, 1);
    for (const l of tx.select().from(loans).where(and(eq(loans.status, "OnLoan"), eq(loans.dueDate, tomorrow))).all()) {
      if (alreadySentToday(tx, ctx, l.id, l.borrowerId, DUE_REMINDER_PREFIX)) continue;
      notify(tx, sys, l.borrowerId, `${DUE_REMINDER_PREFIX}你的借用单 ${l.loanNo} 明天（${l.dueDate}）到期，请按时归还。`, l.id);
      dueSoon.push(l.loanNo);
    }
    return { today: ctx.today, expired, reminded, dueSoon };
  });
}
