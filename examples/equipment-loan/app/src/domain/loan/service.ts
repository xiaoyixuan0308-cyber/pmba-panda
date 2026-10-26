/**
 * Loan operations (use cases). Each one: permission check → validation →
 * one transaction that calls applyTransition(). Messages are business language.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { agreements, approvals, equipment, loanItems, loans, people, type StaffRole } from "@/db/schema";
import { assertCan } from "@/auth/permissions";
import { RegistryUnavailableError } from "@/adapters/asset-registry";
import { dt02, isValuable } from "@/rules/decision-tables";
import { daysBetween } from "@/lib/dates";
import { writeAudit } from "../audit";
import { SYSTEM, type Ctx } from "../context";
import { DomainError } from "../errors";
import { STAFF_ROLE_LABEL, STATUS_LABEL, yuan } from "../labels";
import { getSetting } from "../settings";
import { approvalRule, decisionsOf, nextApprover } from "./approvals";
import { shortItems } from "./availability";
import { GUARDS, overdueLoansOf } from "./guards";
import { applyTransition, enterInitialState, lateFeeFor, loadLoan } from "./transition";

const isoDate = (missing: string) =>
  z.string({ error: missing }).trim().min(1, missing).regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");

/** BR-01: the fields of a request. */
export const loanForm = z.object({
  equipmentIds: z.array(z.number().int().positive(), { error: "请至少选择 1 件设备" }).min(1, "请至少选择 1 件设备"),
  purpose: z.string({ error: "请填写用途" }).trim().min(1, "请填写用途").max(200, "用途不超过 200 字"),
  offCampus: z.boolean({ error: "请选择使用地点（校内或校外）" }),
  teaching: z.boolean().default(false),
  startDate: isoDate("请填写借用日期"),
  dueDate: isoDate("请填写预计归还日期"),
});
export type LoanForm = z.input<typeof loanForm>;

const fieldErrors = (e: z.ZodError) => {
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = String(i.path[0] ?? "form");
    out[k] ??= i.message;
  }
  return out;
};

function nextLoanNo(ctx: Ctx) {
  const row = ctx.db.select({ max: sql<number>`max(cast(substr(${loans.loanNo}, 4) as integer))` }).from(loans).get();
  return `JY-${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

/** FUS1 — submit a request ([*] → Requested). */
export function submitRequest(ctx: Ctx, raw: unknown) {
  assertCan(ctx.actor.role, "loan.create");
  const parsed = loanForm.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION", "申请信息不完整，请按提示补充。", "BR-01", fieldErrors(parsed.error));
  const f = parsed.data;
  const ids = [...new Set(f.equipmentIds)];

  const borrower = ctx.db.select().from(people).where(eq(people.id, ctx.actor.id!)).get()!;
  const items = ctx.db.select().from(equipment).where(inArray(equipment.id, ids)).all();
  if (items.length !== ids.length) throw new DomainError("VALIDATION", "只能选择设备列表中的设备。", "BR-01", { equipmentIds: "有设备不在列表中" });

  if (f.startDate < ctx.today)
    throw new DomainError("VALIDATION", "借用日期不能早于今天。", undefined, { startDate: `最早为 ${ctx.today}` });
  if (f.dueDate <= f.startDate)
    throw new DomainError("VALIDATION", "预计归还日期必须晚于借用日期。", "BR-06", { dueDate: "必须晚于借用日期" });

  const valuable = items.some((e) => isValuable(e.unitPrice));
  const row = dt02({ borrowerType: borrower.borrowerType!, teaching: f.teaching, valuable });
  const days = daysBetween(f.startDate, f.dueDate);
  if (days > row.maxDays)
    throw new DomainError("VALIDATION", `这次最多可以借 ${row.maxDays} 天（DT-02 ${row.rule}），你填写的是 ${days} 天。`, "BR-06", {
      dueDate: `最晚为借用日期后 ${row.maxDays} 天`,
    });

  return ctx.db.transaction((tx) => {
    const loanNo = nextLoanNo(ctx);
    const loan = tx
      .insert(loans)
      .values({ loanNo, borrowerId: borrower.id, status: "Requested", purpose: f.purpose, teaching: f.teaching, offCampus: f.offCampus, startDate: f.startDate, dueDate: f.dueDate, submittedAt: ctx.now })
      .returning()
      .get();
    tx.insert(loanItems).values(ids.map((equipmentId) => ({ loanId: loan.id, equipmentId }))).run();
    writeAudit(tx, ctx, { action: "submit", objectId: loan.id, before: null, after: "Requested" });
    enterInitialState(tx, ctx, loan.id);
    return { loanId: loan.id, loanNo, status: loan.status };
  });
}

/** FUS3 AC1 — the two checks shown side by side on the review page. */
export function reviewChecks(ctx: Ctx, loanId: number) {
  assertCan(ctx.actor.role, "loan.approve");
  const loan = loadLoan(ctx.db, loanId);
  const rule = approvalRule(ctx.db, loan);
  return {
    loan,
    overdueLoans: overdueLoansOf(ctx.db, loan.borrowerId, loan.id),
    shortItems: shortItems(ctx.db, ctx.today, loan.id),
    approvalRule: rule.rule,
    approvers: rule.approvers,
    nextApprover: loan.status === "Requested" ? nextApprover(ctx.db, loan) : null,
    decisions: decisionsOf(ctx.db, loan.id),
  };
}

/** FUS3 AC2 — T1. */
export function moveToWaitlist(ctx: Ctx, loanId: number) {
  assertCan(ctx.actor.role, "loan.review");
  return ctx.db.transaction((tx) => applyTransition(tx, ctx, loanId, "T1"));
}

function checkTurn(ctx: Ctx, loanId: number) {
  const loan = loadLoan(ctx.db, loanId);
  if (loan.status !== "Requested")
    throw new DomainError("INVALID_STATE", `借用单 ${loan.loanNo} 当前为"${STATUS_LABEL[loan.status]}"，不能审批。`, "BR-02");
  const rule = approvalRule(ctx.db, loan);
  const role = ctx.actor.role as StaffRole;
  if (!(rule.approvers as readonly StaffRole[]).includes(role))
    throw new DomainError("FORBIDDEN", `这张借用单不需要${STAFF_ROLE_LABEL[role]}审批（DT-01 ${rule.rule}）。`, "BR-02");
  const next = nextApprover(ctx.db, loan);
  if (next !== role) {
    const done = decisionsOf(ctx.db, loan.id).some((d) => d.approverRole === role);
    throw new DomainError(
      "GUARD_FAILED",
      done ? "你已经审批过这张借用单。" : `需要先由${STAFF_ROLE_LABEL[next ?? "Manager"]}审批。`,
      "BR-02",
    );
  }
  return loan;
}

/**
 * FUS3 AC5, FUS4 AC1–AC2 — approve. When other approvers are still needed the
 * loan stays Requested (internal transition "approve / addApproval");
 * otherwise T3.
 */
export function approve(ctx: Ctx, loanId: number, comment?: string) {
  assertCan(ctx.actor.role, "loan.approve");
  const loan = checkTurn(ctx, loanId);
  return ctx.db.transaction((tx) => {
    for (const g of ["noOverdueLoans", "equipmentAvailable"] as const) {
      const failure = GUARDS[g](tx, ctx, loan, {});
      if (failure) throw new DomainError("GUARD_FAILED", failure.message, failure.rule);
    }
    tx.insert(approvals)
      .values({ loanId, approverId: ctx.actor.id!, approverRole: ctx.actor.role as StaffRole, decision: "Approve", comment: comment?.trim() || null, decidedAt: ctx.now })
      .run();
    if (GUARDS.allApprovalsGiven(tx, ctx, loan, {}) === null) return applyTransition(tx, ctx, loanId, "T3");
    writeAudit(tx, ctx, { action: "addApproval", objectId: loanId, before: "Requested", after: "Requested" });
    return loadLoan(tx, loanId);
  });
}

/** FUS3 AC4, FUS4 AC3 — T4. */
export function reject(ctx: Ctx, loanId: number, reason: string) {
  assertCan(ctx.actor.role, "loan.reject");
  checkTurn(ctx, loanId);
  return ctx.db.transaction((tx) => applyTransition(tx, ctx, loanId, "T4", { reason }));
}

/** FUS2 — T5 or T6. */
export function withdraw(ctx: Ctx, loanId: number) {
  assertCan(ctx.actor.role, "loan.withdraw");
  return ctx.db.transaction((tx) => {
    const loan = loadLoan(tx, loanId);
    if (loan.borrowerId !== ctx.actor.id) throw new DomainError("NOT_FOUND", "找不到这张借用单。", "C-03");
    if (loan.status === "Waitlisted") return applyTransition(tx, ctx, loanId, "T6");
    if (loan.status === "Requested") return applyTransition(tx, ctx, loanId, "T5");
    throw new DomainError("INVALID_STATE", `借用单当前为"${STATUS_LABEL[loan.status]}"，不能撤回。批准后如需取消，请联系设备管理员。`, "BR-08");
  });
}

/** FUS9 — T11. */
export function cancel(ctx: Ctx, loanId: number, reason: string) {
  assertCan(ctx.actor.role, "loan.cancel");
  return ctx.db.transaction((tx) => applyTransition(tx, ctx, loanId, "T11", { reason }));
}

/** BR-05 — the borrower signs the agreement of an approved loan. */
export function signAgreement(ctx: Ctx, loanId: number) {
  assertCan(ctx.actor.role, "agreement.sign");
  return ctx.db.transaction((tx) => {
    const loan = loadLoan(tx, loanId);
    if (loan.borrowerId !== ctx.actor.id) throw new DomainError("NOT_FOUND", "找不到这张借用单。", "C-03");
    if (loan.status !== "Approved")
      throw new DomainError("INVALID_STATE", `借用单当前为"${STATUS_LABEL[loan.status]}"，只有已批准的借用单需要签署协议。`, "BR-05");
    if (tx.select().from(agreements).where(eq(agreements.loanId, loanId)).get())
      throw new DomainError("INVALID_STATE", "借用协议已经签署过了。", "BR-05");
    const a = tx.insert(agreements).values({ loanId, termsVersion: getSetting(ctx.db, "agreementTermsVersion"), signedAt: ctx.now }).returning().get();
    writeAudit(tx, ctx, { action: "signAgreement", objectType: "Agreement", objectId: a.id, after: `协议版本 ${a.termsVersion}` });
    return a;
  });
}

export const REGISTRY_DOWN_MESSAGE = "暂时无法核对资产标签，请稍后再试或联系设备管理员。";

/** FUS5 — T7. Tags are checked before the transaction (build plan section 2). */
export function checkOut(ctx: Ctx, loanId: number) {
  assertCan(ctx.actor.role, "loan.checkOut");
  const loan = loadLoan(ctx.db, loanId);
  if (loan.status !== "Approved")
    throw new DomainError("INVALID_STATE", `借用单 ${loan.loanNo} 当前为"${STATUS_LABEL[loan.status]}"，不能办理借出。`, "BR-05");
  const signed = GUARDS.agreementSigned(ctx.db, ctx, loan, {});
  if (signed) throw new DomainError("GUARD_FAILED", signed.message, signed.rule);

  const tags = ctx.db
    .select({ assetTag: equipment.assetTag })
    .from(loanItems)
    .innerJoin(equipment, eq(equipment.id, loanItems.equipmentId))
    .where(eq(loanItems.loanId, loanId))
    .all();
  const failed: string[] = [];
  try {
    for (const { assetTag } of tags) {
      const r = ctx.registry.verifyAssetTag(assetTag);
      if (!r.valid) failed.push(`${assetTag}（${r.reason}）`);
    }
  } catch (e) {
    if (e instanceof RegistryUnavailableError) throw new DomainError("REGISTRY_UNAVAILABLE", REGISTRY_DOWN_MESSAGE, "BR-11");
    throw e;
  }
  if (failed.length)
    throw new DomainError("GUARD_FAILED", `资产标签核对不通过：${failed.join("；")}。整张借用单不能借出。`, "BR-11");

  return ctx.db.transaction((tx) => {
    tx.update(loans).set({ assetTagsVerifiedAt: ctx.now }).where(eq(loans.id, loanId)).run();
    return applyTransition(tx, ctx, loanId, "T7");
  });
}

/** FUS7 — what the counter has to collect before the return can be recorded. */
export function quoteReturn(ctx: Ctx, loanId: number) {
  assertCan(ctx.actor.role, "loan.return");
  const loan = loadLoan(ctx.db, loanId);
  if (loan.status !== "OnLoan" && loan.status !== "Overdue")
    throw new DomainError("INVALID_STATE", `借用单 ${loan.loanNo} 当前为"${STATUS_LABEL[loan.status]}"，不能办理归还。`);
  const overdue = loan.status === "Overdue" || ctx.today > loan.dueDate;
  const fee = lateFeeFor(ctx, loan.dueDate);
  return { loan, overdue, overdueDays: overdue ? fee.overdueDays : 0, amount: overdue ? fee.amount : 0, capped: overdue && fee.capped, label: `${yuan(fee.amount)} 元` };
}

/**
 * FUS7 — T9 or T10. A loan that is past its due date but not yet flagged by
 * the daily check is flagged first (T8), so the fee rule always applies.
 */
export function recordReturn(ctx: Ctx, loanId: number, opts: { feePaid?: boolean } = {}) {
  assertCan(ctx.actor.role, "loan.return");
  return ctx.db.transaction((tx) => {
    let loan = loadLoan(tx, loanId);
    if (loan.status === "OnLoan" && ctx.today > loan.dueDate) {
      if (!opts.feePaid) {
        const fee = lateFeeFor(ctx, loan.dueDate);
        throw new DomainError("GUARD_FAILED", `请先收取逾期费 ${yuan(fee.amount)} 元，再办理归还。`, "BR-10");
      }
      loan = applyTransition(tx, { ...ctx, actor: SYSTEM }, loanId, "T8");
    }
    if (loan.status === "Overdue") return applyTransition(tx, ctx, loanId, "T10", { feePaid: opts.feePaid });
    return applyTransition(tx, ctx, loanId, "T9");
  });
}
