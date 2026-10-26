/**
 * Equipment availability (BR-03, E18).
 *
 * A loan occupies its equipment when it is
 *   Approved           — from startDate to dueDate (reserved, not yet out)
 *   OnLoan             — from startDate to the later of dueDate and today
 *   Overdue            — from startDate with no end (still not back)
 * Requested and Waitlisted loans do not reserve anything; the stock is
 * checked again when they are approved. Both ends of a period are inclusive.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { equipment, loanItems, loans } from "@/db/schema";
import type { Tx } from "../audit";

export interface Busy {
  equipmentId: number;
  loanId: number;
  loanNo: string;
  from: string;
  to: string;
}

const OPEN_END = "9999-12-31";

export function occupation(tx: Tx, today: string, equipmentIds: number[], excludeLoanId?: number): Busy[] {
  if (equipmentIds.length === 0) return [];
  const rows = tx
    .select({
      equipmentId: loanItems.equipmentId,
      loanId: loans.id,
      loanNo: loans.loanNo,
      status: loans.status,
      startDate: loans.startDate,
      dueDate: loans.dueDate,
    })
    .from(loanItems)
    .innerJoin(loans, eq(loans.id, loanItems.loanId))
    .where(
      and(
        inArray(loanItems.equipmentId, equipmentIds),
        inArray(loans.status, ["Approved", "OnLoan", "Overdue"]),
        excludeLoanId === undefined ? undefined : ne(loans.id, excludeLoanId),
      ),
    )
    .all();
  return rows.map((r) => ({
    equipmentId: r.equipmentId,
    loanId: r.loanId,
    loanNo: r.loanNo,
    from: r.startDate,
    to: r.status === "Overdue" ? OPEN_END : r.status === "OnLoan" && today > r.dueDate ? today : r.dueDate,
  }));
}

export interface ShortItem {
  equipmentId: number;
  assetTag: string;
  model: string;
  heldBy: string[]; // loan numbers
}

/** The items of a loan that are not free for its whole period. Empty = available. */
export function shortItems(tx: Tx, today: string, loanId: number): ShortItem[] {
  const loan = tx.select().from(loans).where(eq(loans.id, loanId)).get()!;
  const items = tx
    .select({ id: equipment.id, assetTag: equipment.assetTag, model: equipment.model })
    .from(loanItems)
    .innerJoin(equipment, eq(equipment.id, loanItems.equipmentId))
    .where(eq(loanItems.loanId, loanId))
    .all();
  const busy = occupation(tx, today, items.map((i) => i.id), loanId);
  const out: ShortItem[] = [];
  for (const it of items) {
    const clash = busy.filter((b) => b.equipmentId === it.id && b.from <= loan.dueDate && loan.startDate <= b.to);
    if (clash.length) out.push({ equipmentId: it.id, assetTag: it.assetTag, model: it.model, heldBy: clash.map((c) => c.loanNo) });
  }
  return out;
}

/** Is one piece of equipment free for a period? (used by the request form's equipment list) */
export function isFreeFor(tx: Tx, today: string, equipmentId: number, from: string, to: string) {
  return !occupation(tx, today, [equipmentId]).some((b) => b.from <= to && from <= b.to);
}
