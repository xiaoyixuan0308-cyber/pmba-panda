/**
 * Guard conditions of the loan state machine (spec/models/06-state-loan.puml).
 * Each returns null when it holds, or a business-language reason when not.
 * Guards are evaluated on the server inside the transition's transaction.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { agreements, loans } from "@/db/schema";
import type { Tx } from "../audit";
import type { Ctx } from "../context";
import { STATUS_LABEL } from "../labels";
import { approvalRule, decisionsOf } from "./approvals";
import { shortItems } from "./availability";
import type { GuardName } from "./transitions";

type LoanRow = typeof loans.$inferSelect;
export interface GuardInput {
  reason?: string;
}
export interface GuardFailure {
  guard: GuardName;
  rule: string;
  message: string;
}

/** BR-12: unreturned overdue loans of the borrower. Returned ones never count (X3, GC-05). */
export function overdueLoansOf(tx: Tx, borrowerId: number, exceptLoanId?: number) {
  return tx
    .select({ id: loans.id, loanNo: loans.loanNo, dueDate: loans.dueDate })
    .from(loans)
    .where(
      and(
        eq(loans.borrowerId, borrowerId),
        inArray(loans.status, ["Overdue"]),
        exceptLoanId === undefined ? undefined : ne(loans.id, exceptLoanId),
      ),
    )
    .all();
}

type GuardFn = (tx: Tx, ctx: Ctx, loan: LoanRow, input: GuardInput) => GuardFailure | null;

export const GUARDS: Record<GuardName, GuardFn> = {
  // BR-03: T1 only when the equipment is short
  notEquipmentAvailable: (tx, ctx, loan) =>
    shortItems(tx, ctx.today, loan.id).length > 0
      ? null
      : { guard: "notEquipmentAvailable", rule: "BR-03", message: "申请的设备在借用期间足够，不需要进入等待名单。" },

  // BR-02: every approver required by DT-01 has agreed
  allApprovalsGiven: (tx, _ctx, loan) => {
    const required = approvalRule(tx, loan).approvers;
    const agreed = new Set(decisionsOf(tx, loan.id).filter((d) => d.decision === "Approve").map((d) => d.approverRole));
    const missing = required.filter((r) => !agreed.has(r));
    return missing.length === 0
      ? null
      : { guard: "allApprovalsGiven", rule: "BR-02", message: "还有审批人没有同意。" };
  },

  // BR-03, E18: stock checked again at approval
  equipmentAvailable: (tx, ctx, loan) => {
    const short = shortItems(tx, ctx.today, loan.id);
    return short.length === 0
      ? null
      : {
          guard: "equipmentAvailable",
          rule: "BR-03",
          message: `设备在借用期间不足：${short.map((s) => `${s.assetTag}（被 ${s.heldBy.join("、")} 占用）`).join("；")}。请转入等待名单。`,
        };
  },

  // BR-12
  noOverdueLoans: (tx, _ctx, loan) => {
    const overdue = overdueLoansOf(tx, loan.borrowerId, loan.id);
    return overdue.length === 0
      ? null
      : {
          guard: "noOverdueLoans",
          rule: "BR-12",
          message: `借用人名下有${STATUS_LABEL.Overdue}、尚未归还的借用单（${overdue.map((o) => o.loanNo).join("、")}），不能批准。`,
        };
  },

  // BR-04, BR-08 (change 001)
  reasonGiven: (_tx, _ctx, _loan, input) =>
    input.reason && input.reason.trim().length > 0
      ? null
      : { guard: "reasonGiven", rule: "BR-04", message: "请填写原因。" },

  // BR-05
  agreementSigned: (tx, _ctx, loan) =>
    tx.select().from(agreements).where(eq(agreements.loanId, loan.id)).get()
      ? null
      : { guard: "agreementSigned", rule: "BR-05", message: "请先签署借用协议。" },

  // BR-11: set by the check-out service after every tag passed the registry
  assetTagsVerified: (_tx, _ctx, loan) =>
    loan.assetTagsVerifiedAt
      ? null
      : { guard: "assetTagsVerified", rule: "BR-11", message: "资产标签尚未全部核对通过。" },

  // BR-07: overdue from the day after the due date
  afterDueDate: (_tx, ctx, loan) =>
    ctx.today > loan.dueDate
      ? null
      : { guard: "afterDueDate", rule: "BR-07", message: "还没有过应还日期。" },
};
