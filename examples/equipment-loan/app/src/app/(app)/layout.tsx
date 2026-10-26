import Link from "next/link";
import { connection } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { Bell, LogOut } from "lucide-react";
import { requireActor, ctxFor } from "@/auth/session";
import { can, type Operation } from "@/auth/permissions";
import { db } from "@/db/client";
import { notifications, people } from "@/db/schema";
import { ROLE_LABEL } from "@/domain/labels";
import type { Role } from "@/domain/context";
import { logout } from "../(public)/login/actions";
import { NavLink } from "./nav-link";

/** Navigation shown only when the role may do it (permissions.ts, same table the server enforces). */
const NAV: { href: string; label: string; roles?: Role[]; op?: Operation }[] = [
  { href: "/me", label: "我的借用单", roles: ["Borrower"] },
  { href: "/loans/new", label: "提交申请", op: "loan.create" },
  { href: "/counter", label: "柜台", roles: ["Clerk"] },
  { href: "/review", label: "审核", roles: ["Manager"] },
  { href: "/approvals", label: "待我审批", roles: ["DeptHead"] },
  { href: "/stats", label: "借用统计", op: "stats.read" },
  { href: "/loans", label: "全部借用单", op: "loan.readAll" },
  { href: "/settings", label: "设置", op: "settings.update" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const actor = await requireActor();
  const ctx = ctxFor(actor);
  const me = db.select().from(people).where(eq(people.id, actor.id!)).get()!;
  const unread = db.select().from(notifications).where(and(eq(notifications.recipientId, actor.id!), isNull(notifications.readAt))).all().length;
  const items = NAV.filter((n) => (n.roles ? n.roles.includes(actor.role) : can(actor.role, n.op!)));

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold text-slate-900">
            设备借用系统
          </Link>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900" title="演示用：在设置页可以修改">
            模拟今天：{ctx.today}
          </span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/notifications" className="relative inline-flex items-center gap-1 text-slate-700 hover:text-slate-900" aria-label={`通知，${unread} 条未读`}>
              <Bell size={18} aria-hidden />
              {unread > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{unread}</span>}
            </Link>
            <span className="text-slate-700">
              {me.name} · {ROLE_LABEL[actor.role]}
            </span>
            <form action={logout}>
              <button type="submit" className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900">
                <LogOut size={16} aria-hidden /> 退出
              </button>
            </form>
          </div>
        </div>
        <nav aria-label="主导航" className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-2">
          {items.map((n) => (
            <NavLink key={n.href} href={n.href}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-600">原型 · 人员、设备和借用记录均为虚构 · 通知为系统内模拟通知</footer>
    </>
  );
}
