import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { ActionForm } from "@/components/action-form";
import { Card } from "@/components/ui";
import { LoanTable } from "@/components/loan-table";
import { overdueList, pendingApprovalsDetailed, waitlistDetailed } from "@/domain/loan/queries";
import { fmtDateTime } from "@/lib/format";
import { runChecksAction } from "../actions";

export default async function ReviewPage() {
  await connection();
  const ctx = ctxFor(await requireActor(["Manager"]));
  const pending = pendingApprovalsDetailed(ctx);
  const waiting = waitlistDetailed(ctx);
  const overdue = overdueList(ctx);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">审核</h1>
      <Card title="每日到期检查">
        <ActionForm action={runChecksAction} label={`运行到期检查（${ctx.today}）`} pendingLabel="正在检查…" variant="secondary">
          <p className="text-sm text-slate-700">把过了应还日期的借用单标为已逾期，提醒超过 2 个工作日未审批的审批人，并提醒明天到期的借用人。正式系统中每天自动运行；原型中按“模拟今天”的日期运行。</p>
        </ActionForm>
      </Card>
      <Card title={`待我审核（${pending.length}）`}>
        <LoanTable rows={pending} empty="没有待审核的申请。" />
      </Card>
      <Card title={`等待名单（按提交时间，${waiting.length}）`}>
        <LoanTable rows={waiting} empty="等待名单为空。" extra={(r) => <span className="text-xs text-slate-600">{fmtDateTime(waiting.find((w) => w.id === r.id)!.submittedAt)}</span>} />
      </Card>
      <Card title={`已逾期（${overdue.length}）`}>
        <LoanTable rows={overdue} empty="没有逾期的借用单。" />
      </Card>
    </div>
  );
}
