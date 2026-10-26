import Link from "next/link";
import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { Card } from "@/components/ui";
import { LoanTable } from "@/components/loan-table";
import { pendingApprovalsDetailed } from "@/domain/loan/queries";
import { monthlyStats } from "@/domain/stats";

export default async function ApprovalsPage() {
  await connection();
  const ctx = ctxFor(await requireActor(["DeptHead"]));
  const pending = pendingApprovalsDetailed(ctx);
  const month = ctx.today.slice(0, 7);
  const s = monthlyStats(ctx, month);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">待我审批</h1>
      <Card title={`设备管理员已同意、等待你审批（${pending.length}）`}>
        <LoanTable rows={pending} empty="没有等待你审批的申请。" />
      </Card>
      <Card title={`本月借用概况（${month}）`} actions={<Link href={`/stats?month=${month}`} className="text-sm text-blue-800 underline">查看统计</Link>}>
        <dl className="grid grid-cols-3 gap-4 text-center">
          <div>
            <dt className="text-sm text-slate-600">申请</dt>
            <dd className="text-2xl font-semibold">{s.submitted}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">借出</dt>
            <dd className="text-2xl font-semibold">{s.checkedOut}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">逾期率</dt>
            <dd className="text-2xl font-semibold">{s.overdueRate === null ? "—" : `${(s.overdueRate * 100).toFixed(1)}%`}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
