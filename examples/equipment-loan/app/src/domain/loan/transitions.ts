/**
 * The loan state machine as data — spec/models/06-state-loan.puml,
 * build plan section 2 (references/uml-to-code-mapping.md section 3).
 *
 * Every status change in the app goes through ./transition.ts, which reads
 * this table. Nothing else writes `loans.status`.
 *
 * Effects not drawn on the diagram but required by the spec:
 *   T9/T10/T11 releaseEquipment — BR-03 (a return or cancellation frees equipment
 *     for the waiting list); T10 recordReturnDate — same as T9;
 *   T11 notifyBorrower — FUS9 AC3; T4 notifyBorrower — BR-04.
 */
import type { LoanStatus } from "@/db/schema";
import type { Role } from "../context";

export type TransitionId = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9" | "T10" | "T11";

export type GuardName =
  | "notEquipmentAvailable"
  | "allApprovalsGiven"
  | "equipmentAvailable"
  | "noOverdueLoans"
  | "reasonGiven"
  | "agreementSigned"
  | "assetTagsVerified"
  | "afterDueDate";

export type EffectName =
  | "notifyBorrower"
  | "recordReason"
  | "releaseEquipment"
  | "recordCheckOutDate"
  | "recordReturnDate"
  | "chargeLateFee";

export interface Transition {
  id: TransitionId;
  from: LoanStatus;
  to: LoanStatus;
  trigger: string;
  /** Who may fire it. "own" = a Borrower only on their own loan. */
  roles: readonly Role[];
  own?: boolean;
  guards: readonly GuardName[];
  effects: readonly EffectName[];
  rules: readonly string[];
  /** Business-language name of the operation, used in messages. */
  label: string;
}

export const TRANSITIONS: Record<TransitionId, Transition> = {
  T1: { id: "T1", from: "Requested", to: "Waitlisted", trigger: "review", roles: ["Manager"], guards: ["notEquipmentAvailable"], effects: [], rules: ["BR-03"], label: "转入等待名单" },
  T2: { id: "T2", from: "Waitlisted", to: "Requested", trigger: "equipmentReleased", roles: ["System"], guards: [], effects: [], rules: ["BR-03"], label: "设备空出，回到已申请" },
  T3: { id: "T3", from: "Requested", to: "Approved", trigger: "approve", roles: ["Manager", "DeptHead"], guards: ["allApprovalsGiven", "equipmentAvailable", "noOverdueLoans"], effects: ["notifyBorrower"], rules: ["BR-02", "BR-03", "BR-12"], label: "批准" },
  T4: { id: "T4", from: "Requested", to: "Rejected", trigger: "reject", roles: ["Manager", "DeptHead"], guards: ["reasonGiven"], effects: ["recordReason", "notifyBorrower"], rules: ["BR-04"], label: "拒绝" },
  T5: { id: "T5", from: "Requested", to: "Withdrawn", trigger: "withdraw", roles: ["Borrower"], own: true, guards: [], effects: ["releaseEquipment"], rules: ["BR-08"], label: "撤回" },
  T6: { id: "T6", from: "Waitlisted", to: "Withdrawn", trigger: "withdraw", roles: ["Borrower"], own: true, guards: [], effects: [], rules: ["BR-08"], label: "撤回" },
  T7: { id: "T7", from: "Approved", to: "OnLoan", trigger: "checkOut", roles: ["Clerk"], guards: ["agreementSigned", "assetTagsVerified"], effects: ["recordCheckOutDate"], rules: ["BR-05", "BR-11"], label: "办理借出" },
  T8: { id: "T8", from: "OnLoan", to: "Overdue", trigger: "expire", roles: ["System"], guards: ["afterDueDate"], effects: [], rules: ["BR-07"], label: "标为已逾期" },
  T9: { id: "T9", from: "OnLoan", to: "Returned", trigger: "return", roles: ["Clerk", "Manager"], guards: [], effects: ["recordReturnDate", "releaseEquipment"], rules: [], label: "办理归还" },
  T10: { id: "T10", from: "Overdue", to: "Returned", trigger: "return", roles: ["Clerk", "Manager"], guards: [], effects: ["recordReturnDate", "chargeLateFee", "releaseEquipment"], rules: ["BR-10"], label: "办理归还" },
  T11: { id: "T11", from: "Approved", to: "Withdrawn", trigger: "cancel", roles: ["Manager"], guards: ["reasonGiven"], effects: ["recordReason", "notifyBorrower", "releaseEquipment"], rules: ["BR-08"], label: "取消" },
};

/** Entry / exit actions of states (state machine "entry /" and "exit /"). */
export const ENTRY: Partial<Record<LoanStatus, "notifyApprovers" | "notifyBorrower" | "notifyBorrowerAndManager">> = {
  Requested: "notifyApprovers",
  Waitlisted: "notifyBorrower",
  Overdue: "notifyBorrowerAndManager",
};
export const EXIT: Partial<Record<LoanStatus, "closeOverdueAlert">> = {
  Overdue: "closeOverdueAlert",
};

export const TERMINAL: readonly LoanStatus[] = ["Rejected", "Withdrawn", "Returned"];

export const transitionsFrom = (status: LoanStatus) => Object.values(TRANSITIONS).filter((t) => t.from === status);
