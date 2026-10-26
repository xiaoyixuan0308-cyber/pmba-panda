import Link from "next/link";
import type { LoanStatus } from "@/db/schema";
import { Empty, StatusBadge } from "./ui";

export interface LoanRowView {
  id: number;
  loanNo: string;
  status: LoanStatus;
  startDate: string;
  dueDate: string;
  borrowerName?: string;
  borrowerNo?: string | null;
  items: string;
}

/** Table on wide screens, stacked cards on phones (NFUS5 AC1). */
export function LoanTable({ rows, showBorrower = true, empty = "没有借用单。", extra }: { rows: LoanRowView[]; showBorrower?: boolean; empty?: string; extra?: (r: LoanRowView) => React.ReactNode }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-600">
          <tr>
            <th className="px-4 py-2 font-medium sm:px-2">编号</th>
            {showBorrower && <th className="px-2 py-2 font-medium">借用人</th>}
            <th className="px-2 py-2 font-medium">设备</th>
            <th className="px-2 py-2 font-medium">借用期间</th>
            <th className="px-2 py-2 font-medium">状态</th>
            {extra && <th className="px-2 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-2 sm:px-2">
                <Link href={`/loans/${r.id}`} className="font-medium text-blue-800 underline-offset-2 hover:underline">
                  {r.loanNo}
                </Link>
              </td>
              {showBorrower && (
                <td className="px-2 py-2">
                  {r.borrowerName} <span className="text-slate-600">{r.borrowerNo}</span>
                </td>
              )}
              <td className="px-2 py-2">{r.items}</td>
              <td className="whitespace-nowrap px-2 py-2">
                {r.startDate} 至 {r.dueDate}
              </td>
              <td className="px-2 py-2">
                <StatusBadge status={r.status} />
              </td>
              {extra && <td className="px-2 py-2">{extra(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
