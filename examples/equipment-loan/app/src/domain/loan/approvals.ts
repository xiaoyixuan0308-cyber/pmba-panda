/** Who must approve a loan (BR-02, DT-01) and what has been decided so far. */
import { eq } from "drizzle-orm";
import { approvals, equipment, loanItems, loans, type StaffRole } from "@/db/schema";
import { dt01, isValuable } from "@/rules/decision-tables";
import type { Tx } from "../audit";

type LoanRow = typeof loans.$inferSelect;

export function hasValuableItem(tx: Tx, loanId: number) {
  return tx
    .select({ unitPrice: equipment.unitPrice })
    .from(loanItems)
    .innerJoin(equipment, eq(equipment.id, loanItems.equipmentId))
    .where(eq(loanItems.loanId, loanId))
    .all()
    .some((e) => isValuable(e.unitPrice));
}

/** DT-01 row for a loan, e.g. { rule: "R2", approvers: ["Manager","DeptHead"] }. */
export function approvalRule(tx: Tx, loan: LoanRow) {
  return dt01({ valuable: hasValuableItem(tx, loan.id), offCampus: loan.offCampus });
}

export function decisionsOf(tx: Tx, loanId: number) {
  return tx.select().from(approvals).where(eq(approvals.loanId, loanId)).orderBy(approvals.decidedAt).all();
}

/**
 * The approver whose turn it is (E07: Manager first, then DeptHead), or null
 * when every required approver has agreed or someone has rejected.
 */
export function nextApprover(tx: Tx, loan: LoanRow): StaffRole | null {
  const decided = decisionsOf(tx, loan.id);
  if (decided.some((d) => d.decision === "Reject")) return null;
  const done = new Set(decided.map((d) => d.approverRole));
  return approvalRule(tx, loan).approvers.find((r) => !done.has(r)) ?? null;
}
