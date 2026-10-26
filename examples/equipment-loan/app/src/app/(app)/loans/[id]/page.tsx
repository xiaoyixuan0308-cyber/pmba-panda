import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { ctxFor, requireActor } from "@/auth/session";
import { can } from "@/auth/permissions";
import { ActionForm } from "@/components/action-form";
import { Card, Notice, StatusBadge, Tag, inputClass } from "@/components/ui";
import { DomainError } from "@/domain/errors";
import { STAFF_ROLE_LABEL, STATUS_LABEL } from "@/domain/labels";
import { getLoanDetail } from "@/domain/loan/queries";
import { getNumber } from "@/domain/settings";
import { yuan } from "@/domain/labels";
import { quoteReturn, reviewChecks } from "@/domain/loan/service";
import { isValuable } from "@/rules/decision-tables";
import { daysBetween } from "@/lib/dates";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { LoanStatus } from "@/db/schema";
import { approveAction, cancelAction, checkOutAction, rejectAction, returnAction, signAction, waitlistAction, withdrawAction } from "../../actions";

const ACTION_LABEL: Record<string, string> = {
  submit: "提交申请", addApproval: "同意（还需下一位审批）", signAgreement: "签署借用协议", chargeLateFee: "收取逾期费",
  "T1 review": "转入等待名单", "T2 equipmentReleased": "设备空出，回到已申请", "T3 approve": "批准", "T4 reject": "拒绝",
  "T5 withdraw": "撤回", "T6 withdraw": "撤回", "T7 checkOut": "办理借出", "T8 expire": "标为已逾期", "T9 return": "办理归还", "T10 return": "办理归还（逾期）", "T11 cancel": "取消",
};

export default async function LoanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await connection();
  const actor = await requireActor();
  const ctx = ctxFor(actor);
  const { id } = await params;
  const sp = await searchParams;
  let d;
  try {
    d = getLoanDetail(ctx, Number(id));
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }
  const { loan, borrower, items, decisions } = d;
  const own = actor.role === "Borrower" && borrower.id === actor.id;
  const fee = `每天 ${yuan(getNumber(ctx.db, "lateFeePerDay"))} 元，最多 ${yuan(getNumber(ctx.db, "lateFeeCap"))} 元`;
  const days = daysBetween(loan.startDate, loan.dueDate);
  const myTurn = loan.status === "Requested" && d.nextApprover === actor.role;
  const checks = myTurn ? reviewChecks(ctx, loan.id) : null;
  const returning = (loan.status === "OnLoan" || loan.status === "Overdue") && can(actor.role, "loan.return") ? quoteReturn(ctx, loan.id) : null;

  return (
    <div className="space-y-6">
      {sp.created && (
        <Notice tone="success">
          申请已提交，借用单编号 <strong>{loan.loanNo}</strong>。设备管理员审核后会通知你。
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">借用单 {loan.loanNo}</h1>
        <StatusBadge status={loan.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title="申请信息">
            <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-600">借用人</dt>
              <dd>
                {borrower.name}（{borrower.borrowerNo}，{borrower.borrowerType === "Teacher" ? "教师" : "学生"}，{borrower.department}）
              </dd>
              <dt className="text-slate-600">手机号</dt>
              <dd>{borrower.phone}</dd>
              <dt className="text-slate-600">用途</dt>
              <dd>
                {loan.purpose} {loan.teaching && <Tag>教学</Tag>}
              </dd>
              <dt className="text-slate-600">使用地点</dt>
              <dd>{loan.offCampus ? "校外" : "校内"}</dd>
              <dt className="text-slate-600">借用期间</dt>
              <dd>
                {loan.startDate} 至 {loan.dueDate}（{days} 天）
              </dd>
              <dt className="text-slate-600">提交时间</dt>
              <dd>{fmtDateTime(loan.submittedAt)}</dd>
              {loan.checkOutDate && (
                <>
                  <dt className="text-slate-600">借出时间</dt>
                  <dd>{fmtDateTime(loan.checkOutDate)}</dd>
                </>
              )}
              {loan.returnDate && (
                <>
                  <dt className="text-slate-600">归还日期</dt>
                  <dd>{loan.returnDate}</dd>
                </>
              )}
              {loan.closingReason && (
                <>
                  <dt className="text-slate-600">取消原因</dt>
                  <dd>{loan.closingReason}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card title={`设备（${items.length} 件）`}>
            <ul className="divide-y divide-slate-100 text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <code className="font-medium">{i.assetTag}</code> {i.model} <span className="text-slate-600">· {i.category}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {isValuable(i.unitPrice) && <Tag tone="amber">贵重</Tag>}
                    <span className="text-slate-700">{fmtMoney(i.unitPrice)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="审批记录">
            {decisions.length === 0 ? (
              <p className="text-sm text-slate-600">还没有审批。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {decisions.map((x) => (
                  <li key={x.id} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{STAFF_ROLE_LABEL[x.approverRole]}</span>
                    <span>{x.approverName}</span>
                    <span className={x.decision === "Approve" ? "text-emerald-800" : "text-red-700"}>{x.decision === "Approve" ? "同意" : "不同意"}</span>
                    <span className="text-slate-600">{fmtDateTime(x.decidedAt)}</span>
                    {x.comment && <span className="w-full text-slate-700">意见：{x.comment}</span>}
                  </li>
                ))}
              </ul>
            )}
            {loan.status === "Requested" && d.nextApprover && <p className="mt-2 text-sm text-slate-700">当前等待：{STAFF_ROLE_LABEL[d.nextApprover]}</p>}
          </Card>

          {d.history && (
            <Card title="操作历史">
              <ol className="space-y-1.5 text-sm">
                {d.history.map((h) => (
                  <li key={h.id} className="grid grid-cols-[9.5rem_1fr] gap-2">
                    <span className="text-slate-600">{fmtDateTime(h.at)}</span>
                    <span>
                      {ACTION_LABEL[h.action] ?? h.action}
                      {h.before && h.after && h.before !== h.after && h.objectType === "Loan" && (
                        <span className="text-slate-600">
                          （{STATUS_LABEL[h.before as LoanStatus]} → {STATUS_LABEL[h.after as LoanStatus]}）
                        </span>
                      )}
                      {h.objectType !== "Loan" && h.after && <span className="text-slate-600">（{h.after}）</span>}
                      <span className="text-slate-600"> · {h.actorName ?? "系统"}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          {d.agreement && (
            <Card title="借用协议">
              <p className="flex items-center gap-1.5 text-sm text-emerald-800">
                <CheckCircle2 size={16} aria-hidden /> 已签署（版本 {d.agreement.termsVersion}，{fmtDateTime(d.agreement.signedAt)}）
              </p>
            </Card>
          )}
          {d.lateFee && (
            <Card title="逾期费">
              <p className="text-sm">
                逾期 {d.lateFee.overdueDays} 天，{fmtMoney(d.lateFee.amount)}，{d.lateFee.paidAt ? `已于 ${fmtDateTime(d.lateFee.paidAt)} 缴纳` : "未缴"}
              </p>
            </Card>
          )}

          {decisions
            .filter((x) => x.approverId === actor.id)
            .map((x) => (
              <Notice key={x.id} tone="success">
                你已于 {fmtDateTime(x.decidedAt)} {x.decision === "Approve" ? "同意" : "拒绝"}这张借用单。当前状态：{STATUS_LABEL[loan.status]}
                {loan.status === "Requested" && d.nextApprover ? `，等待${STAFF_ROLE_LABEL[d.nextApprover]}审批` : ""}。
              </Notice>
            ))}
          {own && (loan.status === "Requested" || loan.status === "Waitlisted") && (
            <Card title="撤回申请">
              <ActionForm action={withdrawAction} loanId={loan.id} label="撤回申请" variant="danger">
                <p className="text-sm text-slate-700">批准前可以撤回。撤回后不能恢复，需要时请重新申请。</p>
              </ActionForm>
            </Card>
          )}
          {own && loan.status === "Approved" && !d.agreement && (
            <Card title="签署借用协议">
              <ActionForm action={signAction} loanId={loan.id} label="签署协议">
                <div className="max-h-40 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                  借用人承诺：按约定用途和地点使用设备；在应还日期或之前归还；逾期按{fee}收取逾期费；设备损坏或遗失按设备室规定处理。（演示文本）
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="agree" className="h-4 w-4" /> 我已阅读并同意借用协议
                </label>
              </ActionForm>
            </Card>
          )}
          {own && loan.status === "Approved" && d.agreement && <Notice>协议已签署。请在 {loan.startDate} 到设备室领取设备。</Notice>}
          {own && loan.status === "Overdue" && (
            <Notice tone="error">这张借用单已逾期，请尽快归还。逾期费{fee}。</Notice>
          )}

          {checks && (
            <Card title="审核检查">
              <ul className="space-y-3 text-sm">
                <li className="flex gap-2">
                  {checks.overdueLoans.length ? <XCircle className="shrink-0 text-red-700" size={18} aria-hidden /> : <CheckCircle2 className="shrink-0 text-emerald-700" size={18} aria-hidden />}
                  <span>
                    <strong className="block">逾期未还</strong>
                    {checks.overdueLoans.length ? (
                      <>
                        借用人名下有已逾期、尚未归还的借用单：
                        {checks.overdueLoans.map((o) => (
                          <Link key={o.id} href={`/loans/${o.id}`} className="ml-1 text-blue-800 underline">
                            {o.loanNo}
                          </Link>
                        ))}
                        。不能批准。
                      </>
                    ) : (
                      "没有逾期未还的借用单"
                    )}
                  </span>
                </li>
                <li className="flex gap-2">
                  {checks.shortItems.length ? <AlertTriangle className="shrink-0 text-amber-700" size={18} aria-hidden /> : <CheckCircle2 className="shrink-0 text-emerald-700" size={18} aria-hidden />}
                  <span>
                    <strong className="block">设备是否足够</strong>
                    {checks.shortItems.length
                      ? checks.shortItems.map((s) => `${s.assetTag} 在借用期间被 ${s.heldBy.join("、")} 占用`).join("；")
                      : "借用期间设备足够"}
                  </span>
                </li>
                <li className="text-slate-700">
                  审批人（DT-01 {checks.approvalRule}）：{checks.approvers.map((r) => STAFF_ROLE_LABEL[r]).join(" → ")}
                </li>
              </ul>
            </Card>
          )}
          {checks && (
            <Card title="审批">
              <div className="space-y-5">
                <ActionForm action={approveAction} loanId={loan.id} label={checks.approvers.at(-1) === actor.role ? "批准" : "同意，交部门负责人审批"}>
                  {(checks.overdueLoans.length > 0 || checks.shortItems.length > 0) && <p className="text-sm text-slate-700">检查未通过时，系统会拒绝批准。</p>}
                </ActionForm>
                {checks.shortItems.length > 0 && actor.role === "Manager" && (
                  <ActionForm action={waitlistAction} loanId={loan.id} label="转入等待名单" variant="secondary" />
                )}
                <ActionForm action={rejectAction} loanId={loan.id} label="拒绝" variant="danger">
                  <label htmlFor="reason" className="block text-sm font-medium">
                    拒绝原因<span className="text-red-700">*</span>
                  </label>
                  <textarea id="reason" name="reason" rows={2} className={inputClass} placeholder="会发送给借用人" />
                </ActionForm>
              </div>
            </Card>
          )}

          {loan.status === "Approved" && can(actor.role, "loan.cancel") && (
            <Card title="取消借用单">
              <ActionForm action={cancelAction} loanId={loan.id} label="取消借用单" variant="danger">
                <label htmlFor="cancel-reason" className="block text-sm font-medium">
                  取消原因<span className="text-red-700">*</span>
                </label>
                <textarea id="cancel-reason" name="reason" rows={2} className={inputClass} placeholder="会发送给借用人" />
              </ActionForm>
            </Card>
          )}

          {loan.status === "Approved" && can(actor.role, "loan.checkOut") && (
            <Card title="办理借出" actions={<Tag tone="amber">资产核对：模拟数据</Tag>}>
              <ActionForm action={checkOutAction} loanId={loan.id} label="核对资产标签并借出" pendingLabel="正在核对资产标签…">
                <ul className="space-y-1 text-sm">
                  <li className="flex items-center gap-1.5">
                    {d.agreement ? <CheckCircle2 className="text-emerald-700" size={16} aria-hidden /> : <XCircle className="text-red-700" size={16} aria-hidden />}
                    借用协议{d.agreement ? "已签署" : "未签署"}
                  </li>
                  <li className="text-slate-700">系统会逐件在资产登记系统中核对标签，任何一件不通过都不能借出。</li>
                </ul>
              </ActionForm>
            </Card>
          )}

          {returning && (
            <Card title="办理归还">
              <ActionForm action={returnAction} loanId={loan.id} label="确认归还">
                {returning.overdue ? (
                  <>
                    <Notice tone="warning">
                      逾期 {returning.overdueDays} 天，应收逾期费 <strong>{fmtMoney(returning.amount)}</strong>
                      {returning.capped && "（已达上限）"}。逾期费不能减免。
                    </Notice>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="feePaid" className="h-4 w-4" /> 已当场收取 {fmtMoney(returning.amount)}
                    </label>
                  </>
                ) : (
                  <p className="text-sm text-slate-700">未逾期，不收逾期费。</p>
                )}
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
