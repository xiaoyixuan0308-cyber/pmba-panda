/** Display names from spec/glossary.md (the single source of names). */
import type { LoanStatus, StaffRole } from "@/db/schema";
import type { Role } from "./context";

export const STATUS_LABEL: Record<LoanStatus, string> = {
  Requested: "已申请",
  Waitlisted: "等待设备",
  Approved: "已批准",
  Rejected: "已拒绝",
  Withdrawn: "已撤回",
  OnLoan: "借出中",
  Overdue: "已逾期",
  Returned: "已归还",
};

export const ROLE_LABEL: Record<Role, string> = {
  Borrower: "借用人",
  Clerk: "办事员",
  Manager: "设备管理员",
  DeptHead: "部门负责人",
  System: "系统",
};

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  Clerk: "办事员",
  Manager: "设备管理员",
  DeptHead: "部门负责人",
};

export const yuan = (cents: number) => (cents % 100 === 0 ? `${cents / 100}` : (cents / 100).toFixed(2));
