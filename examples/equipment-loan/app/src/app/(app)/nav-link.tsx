"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = path === href || (href !== "/loans" && path.startsWith(`${href}/`)) || (href === "/loans" && /^\/loans\/\d+/.test(path));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${active ? "border-blue-700 font-medium text-blue-800" : "border-transparent text-slate-700 hover:text-slate-900"}`}
    >
      {children}
    </Link>
  );
}
