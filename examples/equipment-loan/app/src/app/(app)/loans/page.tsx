import Link from "next/link";
import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { Button, Card, inputClass } from "@/components/ui";
import { LoanTable } from "@/components/loan-table";
import { LOAN_STATUSES, type LoanStatus } from "@/db/schema";
import { STATUS_LABEL } from "@/domain/labels";
import { listLoans } from "@/domain/loan/queries";

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  await connection();
  const ctx = ctxFor(await requireActor());
  const sp = await searchParams;
  const status = LOAN_STATUSES.includes(sp.status as LoanStatus) ? (sp.status as LoanStatus) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const r = listLoans(ctx, { q: sp.q, status: status ? [status] : undefined, page });
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const link = (p: number) => `/loans?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(status ? { status } : {}), page: String(p) })}`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{ctx.actor.role === "Borrower" ? "我的借用单" : "全部借用单"}</h1>
      <form className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]" role="search">
        <label htmlFor="q" className="sr-only">
          关键词
        </label>
        <input id="q" name="q" defaultValue={sp.q} className={inputClass} placeholder="借用单编号、借用人姓名或学工号、资产标签" />
        <label htmlFor="status" className="sr-only">
          状态
        </label>
        <select id="status" name="status" defaultValue={status ?? ""} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <option value="">全部状态</option>
          {LOAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <Button type="submit">查找</Button>
      </form>
      <Card title={`共 ${r.total} 张`}>
        <LoanTable rows={r.rows} showBorrower={ctx.actor.role !== "Borrower"} empty="没有符合条件的借用单。" />
        {pages > 1 && (
          <nav aria-label="分页" className="mt-4 flex items-center justify-between text-sm">
            {page > 1 ? <Link href={link(page - 1)} className="text-blue-800 underline">上一页</Link> : <span />}
            <span className="text-slate-600">
              第 {page} / {pages} 页
            </span>
            {page < pages ? <Link href={link(page + 1)} className="text-blue-800 underline">下一页</Link> : <span />}
          </nav>
        )}
      </Card>
    </div>
  );
}
