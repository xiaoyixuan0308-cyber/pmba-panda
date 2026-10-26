import Link from "next/link";
import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { Card, Empty, Tag } from "@/components/ui";
import { markNotificationsRead, myNotifications } from "@/domain/loan/queries";
import { fmtDateTime } from "@/lib/format";

export default async function NotificationsPage() {
  await connection();
  const ctx = ctxFor(await requireActor());
  const list = myNotifications(ctx);
  markNotificationsRead(ctx);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">通知</h1>
        <Tag tone="amber">模拟通知</Tag>
      </div>
      <p className="text-sm text-slate-600">原型中通知只在系统内显示；正式系统会通过邮件或企业微信发送。</p>
      <Card>
        {list.length === 0 ? (
          <Empty>还没有通知。</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((n) => (
              <li key={n.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className={n.readAt ? "text-slate-700" : "font-medium text-slate-900"}>{n.message}</span>
                  <span className="text-xs text-slate-600">{fmtDateTime(n.createdAt)}</span>
                </div>
                {n.loanId && (
                  <Link href={`/loans/${n.loanId}`} className="text-xs text-blue-800 underline">
                    查看借用单
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
