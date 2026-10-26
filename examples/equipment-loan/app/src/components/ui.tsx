/** Small UI kit in the shadcn/ui style (hand-written: the registry was not reachable). */
import type { ComponentProps, ReactNode } from "react";
import type { LoanStatus } from "@/db/schema";
import { STATUS_LABEL } from "@/domain/labels";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const variants = {
  primary: "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:text-red-300",
} as const;

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return (
    <button
      {...p}
      className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed", variants[variant], className)}
    />
  );
}

export function LinkButton({ variant = "secondary", className, ...p }: ComponentProps<"a"> & { variant?: keyof typeof variants }) {
  return <a {...p} className={cx("inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium", variants[variant], className)} />;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const statusTone: Record<LoanStatus, string> = {
  Requested: "bg-blue-50 text-blue-800 ring-blue-200",
  Waitlisted: "bg-amber-50 text-amber-900 ring-amber-300",
  Approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Rejected: "bg-slate-100 text-slate-700 ring-slate-300",
  Withdrawn: "bg-slate-100 text-slate-700 ring-slate-300",
  OnLoan: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  Overdue: "bg-red-50 text-red-800 ring-red-300",
  Returned: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function StatusBadge({ status }: { status: LoanStatus }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", statusTone[status])}>{STATUS_LABEL[status]}</span>;
}

export function Tag({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" | "red" | "green" }) {
  const t = { slate: "bg-slate-100 text-slate-700", amber: "bg-amber-100 text-amber-900", red: "bg-red-100 text-red-800", green: "bg-emerald-100 text-emerald-800" }[tone];
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const t = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    error: "border-red-300 bg-red-50 text-red-900",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", t)}>
      {children}
    </div>
  );
}

export function Field({ label, required, error, hint, htmlFor, children }: { label: string; required?: boolean; error?: string; hint?: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
        {label}
        {required && <span className="ml-0.5 text-red-700" aria-label="必填">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-600">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "block w-full min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 aria-[invalid=true]:border-red-500";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-600">{children}</p>;
}

export { cx };
