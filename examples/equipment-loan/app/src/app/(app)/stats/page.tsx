import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { Button, Card } from "@/components/ui";
import { LOAN_STATUSES } from "@/db/schema";
import { STATUS_LABEL } from "@/domain/labels";
import { monthlyStats } from "@/domain/stats";
import { addDays } from "@/lib/dates";

function recentMonths(today: string, n = 13) {
  const out: string[] = [];
  let d = `${today.slice(0, 7)}-01`;
  for (let i = 0; i < n; i++) {
    out.push(d.slice(0, 7));
    d = `${addDays(d, -1).slice(0, 7)}-01`;
  }
  return out;
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await connection();
  const ctx = ctxFor(await requireActor(["DeptHead"]));
  const months = recentMonths(ctx.today);
  const sp = await searchParams;
  const month = sp.month && months.includes(sp.month) ? sp.month : months[0];
  const s = monthlyStats(ctx, month);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">借用统计</h1>
      <form className="flex items-end gap-2">
        <div>
          <label htmlFor="month" className="block text-sm font-medium text-slate-800">
            月份
          </label>
          <select id="month" name="month" defaultValue={month} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
            {months.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          查看
        </Button>
      </form>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={`${month} 借用单数（按提交月份）：${s.submitted}`}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {LOAN_STATUSES.map((st) => (
                <tr key={st}>
                  <th scope="row" className="py-1.5 text-left font-normal text-slate-700">
                    {STATUS_LABEL[st]}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{s.byStatus[st]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="逾期率">
          <p className="text-3xl font-semibold">{s.overdueRate === null ? "—" : `${(s.overdueRate * 100).toFixed(1)}%`}</p>
          <p className="mt-2 text-sm text-slate-700">
            当月产生逾期的借用单 {s.becameOverdue} 张 ÷ 当月借出的借用单 {s.checkedOut} 张。逾期从应还日期的次日算起。
          </p>
        </Card>
      </div>

      <Card title="借出次数最多的 10 件设备">
        {s.top10.length === 0 ? (
          <p className="text-sm text-slate-600">这个月没有借出记录。</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-1.5 text-left font-medium">#</th>
                <th className="py-1.5 text-left font-medium">资产标签</th>
                <th className="py-1.5 text-left font-medium">型号</th>
                <th className="py-1.5 text-right font-medium">借出次数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.top10.map((t, i) => (
                <tr key={t.assetTag}>
                  <td className="py-1.5">{i + 1}</td>
                  <td className="py-1.5">
                    <code>{t.assetTag}</code>
                  </td>
                  <td className="py-1.5">{t.model}</td>
                  <td className="py-1.5 text-right tabular-nums">{t.checkOuts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
