/**
 * BR-13, FUS11 — monthly statistics for the DeptHead. `month` is 'YYYY-MM'
 * in local time.
 *   loans by status   — loans submitted in the month, by current status
 *   top 10 equipment  — most checked out in the month
 *   overdue rate      — loans that became overdue in the month (overdue from
 *                       the day after the due date, BR-07) ÷ loans checked out
 *                       in the month
 */
import { assertCan } from "@/auth/permissions";
import { equipment, loanItems, loans, LOAN_STATUSES, type LoanStatus } from "@/db/schema";
import { addDays, localDateOf } from "@/lib/dates";
import type { Ctx } from "./context";
import { DomainError } from "./errors";

export function monthlyStats(ctx: Ctx, month: string) {
  assertCan(ctx.actor.role, "stats.read");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError("VALIDATION", "月份格式应为 YYYY-MM。");
  const inMonth = (iso: string) => iso.slice(0, 7) === month;

  const all = ctx.db.select().from(loans).all();
  const byStatus = Object.fromEntries(LOAN_STATUSES.map((s) => [s, 0])) as Record<LoanStatus, number>;
  for (const l of all) if (inMonth(localDateOf(l.submittedAt))) byStatus[l.status]++;

  const checkedOut = all.filter((l) => l.checkOutDate && inMonth(localDateOf(l.checkOutDate)));
  const becameOverdue = all.filter(
    (l) => (l.status === "Overdue" || (l.returnDate !== null && l.returnDate > l.dueDate)) && inMonth(addDays(l.dueDate, 1)) && addDays(l.dueDate, 1) <= ctx.today,
  );

  const counts = new Map<number, number>();
  const outIds = new Set(checkedOut.map((l) => l.id));
  for (const it of ctx.db.select().from(loanItems).all()) if (outIds.has(it.loanId)) counts.set(it.equipmentId, (counts.get(it.equipmentId) ?? 0) + 1);
  const eq_ = new Map(ctx.db.select().from(equipment).all().map((e) => [e.id, e]));
  const top10 = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || eq_.get(a[0])!.assetTag.localeCompare(eq_.get(b[0])!.assetTag))
    .slice(0, 10)
    .map(([id, n]) => ({ assetTag: eq_.get(id)!.assetTag, model: eq_.get(id)!.model, checkOuts: n }));

  return {
    month,
    submitted: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    top10,
    checkedOut: checkedOut.length,
    becameOverdue: becameOverdue.length,
    overdueRate: checkedOut.length ? becameOverdue.length / checkedOut.length : null,
  };
}
