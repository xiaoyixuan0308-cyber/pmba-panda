import Link from "next/link";
import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { Card, LinkButton, Notice } from "@/components/ui";
import { LoanTable } from "@/components/loan-table";
import { addDays } from "@/lib/dates";
import { myLoans, myOverdueLoans } from "@/domain/loan/queries";

export default async function MyPage() {
  await connection();
  const ctx = ctxFor(await requireActor(["Borrower"]));
  const loans = myLoans(ctx);
  const overdue = myOverdueLoans(ctx);
  const soon = loans.filter((l) => l.status === "OnLoan" && l.dueDate <= addDays(ctx.today, 1));
  const open = loans.filter((l) => !["Returned", "Rejected", "Withdrawn"].includes(l.status));
  const closed = loans.filter((l) => ["Returned", "Rejected", "Withdrawn"].includes(l.status));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">我的借用单</h1>
        <LinkButton href="/loans/new" variant="primary">
          提交申请
        </LinkButton>
      </div>
      {overdue.length > 0 && (
        <Notice tone="error">
          <strong>你有 {overdue.length} 张借用单已逾期，请尽快归还：</strong>
          {overdue.map((o) => (
            <Link key={o.id} href={`/loans/${o.id}`} className="ml-2 underline">
              {o.loanNo}（应还 {o.dueDate}）
            </Link>
          ))}
          <span className="block">有逾期未还的借用单时，新的申请不能批准。</span>
        </Notice>
      )}
      {soon.map((s) => (
        <Notice key={s.id} tone="warning">
          {s.loanNo} 将于 {s.dueDate} 到期，请按时归还。
        </Notice>
      ))}
      <Card title={`进行中（${open.length}）`}>
        <LoanTable rows={open} showBorrower={false} empty="没有进行中的借用单。" />
      </Card>
      <Card title={`已结束（${closed.length}）`}>
        <LoanTable rows={closed} showBorrower={false} empty="没有已结束的借用单。" />
      </Card>
    </div>
  );
}
