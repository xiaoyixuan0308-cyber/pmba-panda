/**
 * Demo data for the equipment loan prototype (build plan section 5a).
 *
 * Everything here is fictional (C-06). The demo "today" is 2026-10-08, the
 * date the ledger (spec/00-materials/M1) was exported. Seed data is written
 * directly in its final state; tests/integration/seed-data.test.ts proves it
 * is consistent with the state machine, the decision tables and the ledger.
 */
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { DT01, dt01, dt02, isValuable } from "../src/rules/decision-tables";
import { addDays, atLocal, daysBetween } from "../src/lib/dates";
import type { BorrowerType, LoanStatus, StaffRole } from "../src/db/schema";

export const DEMO_TODAY = "2026-10-08";
export const HISTORY_START = "2025-10-08";
export const DEMO_PASSWORD = "demo1234";
export const LATE_FEE_PER_DAY = 1000; // cents
export const LATE_FEE_CAP = 20000; // cents

// ---------------------------------------------------------------- random

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261008);
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

// ---------------------------------------------------------------- types

export interface PersonRow {
  key: string; // borrowerNo or staffNo
  kind: "borrower" | "staff";
  name: string;
  email: string;
  phone: string;
  borrowerType?: BorrowerType;
  department?: string;
  staffRole?: StaffRole;
}

export interface EquipmentRow {
  assetTag: string;
  model: string;
  category: string;
  unitPrice: number; // cents
}

export interface ApprovalRow {
  role: StaffRole;
  decision: "Approve" | "Reject";
  comment?: string;
  decidedAt: Date;
}

export interface LoanRow {
  loanNo: string;
  borrower: string; // borrowerNo
  status: LoanStatus;
  purpose: string;
  teaching: boolean;
  offCampus: boolean;
  startDate: string;
  dueDate: string;
  submittedAt: Date;
  items: string[]; // asset tags
  approvals: ApprovalRow[];
  agreementSignedAt?: Date;
  assetTagsVerifiedAt?: Date;
  checkOutDate?: Date;
  returnDate?: string;
  closingReason?: string;
  lateFee?: { overdueDays: number; amount: number; paidAt?: Date };
  audit: { action: string; at: Date; actor: "borrower" | StaffRole | "system"; before?: string; after?: string; note?: string }[];
  source: "ledger" | "generated";
}

export interface ImportIssue {
  loanNo: string;
  kind: "rejected" | "warning";
  message: string;
}

// ---------------------------------------------------------------- people

const SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤".split("");
const GIVEN = "子涵欣怡梓萱诗涵一诺依诺雨桐可馨思彤浩然宇轩博文子墨梓睿俊杰皓轩明轩天佑若曦语嫣晨阳嘉怡志远文博家豪思远雅琪梦洁静怡晓东建国志强海燕秀英丽娟".split("");
const DEPARTMENTS = ["新闻系", "广播电视系", "数字媒体系", "广告系", "影视编导系"];

const usedNames = new Set<string>();
function fictionalName() {
  for (;;) {
    const n = pick(SURNAMES) + pick(GIVEN) + (chance(0.6) ? pick(GIVEN) : "");
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return n;
    }
  }
}
let phoneSeq = 0;
/**
 * Fictional phone numbers that cannot belong to anyone: Chinese mobile numbers
 * start with 13–19, so a 10 prefix is never allocated. They still have 11 digits
 * and pass the same format check as real numbers (C-06).
 */
const fictionalPhone = () => `1000000${String(++phoneSeq).padStart(4, "0")}`;

function borrower(no: string, type: BorrowerType, email?: string): PersonRow {
  return {
    key: no,
    kind: "borrower",
    name: fictionalName(),
    email: email ?? `${no.toLowerCase()}@demo.local`,
    phone: fictionalPhone(),
    borrowerType: type,
    department: pick(DEPARTMENTS),
  };
}

export const DEMO_ACCOUNTS = [
  { email: "student@demo.local", role: "借用人（学生，GC-01 的 S-060）" },
  { email: "teacher@demo.local", role: "借用人（教师，GC-02 的 T-003）" },
  { email: "clerk@demo.local", role: "办事员" },
  { email: "manager@demo.local", role: "设备管理员" },
  { email: "depthead@demo.local", role: "部门负责人" },
] as const;

export function buildPeople() {
  const people: PersonRow[] = [
    { key: "C-001", kind: "staff", name: fictionalName(), email: "clerk@demo.local", phone: fictionalPhone(), staffRole: "Clerk" },
    { key: "C-002", kind: "staff", name: fictionalName(), email: "c-002@demo.local", phone: fictionalPhone(), staffRole: "Clerk" },
    { key: "M-001", kind: "staff", name: fictionalName(), email: "manager@demo.local", phone: fictionalPhone(), staffRole: "Manager" },
    { key: "D-001", kind: "staff", name: fictionalName(), email: "depthead@demo.local", phone: fictionalPhone(), staffRole: "DeptHead" },
  ];
  // Borrowers named in the ledger (M1) and in the golden cases.
  const named: [string, BorrowerType, string?][] = [
    ["S-014", "Student"], ["T-003", "Teacher", "teacher@demo.local"], ["S-022", "Student"],
    ["S-031", "Student"], ["T-007", "Teacher"], ["S-045", "Student"], ["S-050", "Student"],
    ["S-060", "Student", "student@demo.local"], ["S-061", "Student"], ["S-062", "Student"],
  ];
  for (const [no, type, email] of named) people.push(borrower(no, type, email));
  // Generated borrowers for the history: S-100..S-499, T-100..T-139.
  for (let i = 100; i < 500; i++) people.push(borrower(`S-${i}`, "Student"));
  for (let i = 100; i < 140; i++) people.push(borrower(`T-${i}`, "Teacher"));
  return people;
}

// ---------------------------------------------------------------- equipment

/** 320 items, 40 valuable (unit price > 5000.00), plus one at exactly 5000.00. */
const CATALOGUE: { prefix: string; category: string; model: string; price: number; from: number; count: number }[] = [
  { prefix: "AV", category: "投影仪", model: "便携投影仪 P3", price: 320000, from: 101, count: 40 },
  { prefix: "CAM", category: "摄像机", model: "4K 摄像机 X20", price: 1200000, from: 1, count: 14 },
  { prefix: "DSC", category: "相机", model: "微单相机 A7", price: 560000, from: 1, count: 15 },
  { prefix: "LEN", category: "镜头", model: "变焦镜头 24-70", price: 680000, from: 1, count: 10 },
  { prefix: "DRN", category: "无人机", model: "航拍无人机 M2", price: 860000, from: 2, count: 1 },
  { prefix: "TRI", category: "三脚架", model: "铝合金三脚架", price: 45000, from: 1, count: 60 },
  { prefix: "MIC", category: "话筒", model: "无线领夹话筒", price: 90000, from: 101, count: 60 },
  { prefix: "LGT", category: "补光灯", model: "LED 补光灯", price: 120000, from: 1, count: 40 },
  { prefix: "REC", category: "录音笔", model: "录音笔 R1", price: 80000, from: 1, count: 39 },
  { prefix: "GIM", category: "稳定器", model: "手持稳定器 G5", price: 500000, from: 1, count: 1 },
  { prefix: "STD", category: "灯架", model: "灯架 2m", price: 30000, from: 1, count: 40 },
];

export function buildEquipment(): EquipmentRow[] {
  const rows: EquipmentRow[] = [];
  for (const c of CATALOGUE) {
    for (let i = 0; i < c.count; i++) {
      rows.push({
        assetTag: `${c.prefix}-${String(c.from + i).padStart(4, "0")}`,
        model: c.model,
        category: c.category,
        unitPrice: c.price,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- ledger import

const ledgerStatus: Record<string, LoanStatus> = {
  已还: "Returned",
  已借出: "OnLoan",
  已批: "Approved",
  待审: "Requested",
  不借: "Rejected",
};

/** User-supplied facts about ledger rows that the ledger itself does not record. */
const LEDGER_SUPPLEMENTS: Record<string, { teaching: boolean; offCampus: boolean; purpose: string }> = {
  "JY-0902": { teaching: true, offCampus: true, purpose: "校外拍摄教学素材" }, // GC-02, user supplement
  "JY-0906": { teaching: true, offCampus: false, purpose: "课堂教学" }, // ledger remark "教学用"
};

function parseCsv(file: string) {
  const [header, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = header.split(",");
  return lines.map((l) => {
    const cells = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""])) as Record<string, string>;
  });
}

export function importLedger(csvPath: string) {
  const rows = parseCsv(csvPath);
  const loans: LoanRow[] = [];
  const issues: ImportIssue[] = [];

  for (const r of rows) {
    const no = r["登记号"];
    if (!r["借出日期"] || !r["应还日期"]) {
      issues.push({
        loanNo: no,
        kind: "rejected",
        message: `缺少借用日期或应还日期（台账状态"${r["状态"]}"，备注"${r["备注"] || "无"}"）。新系统要求每张借用单都有日期（BR-01），未导入，请用户决定如何处理。`,
      });
      continue;
    }
    const supplement = LEDGER_SUPPLEMENTS[no];
    if (!supplement) {
      issues.push({
        loanNo: no,
        kind: "warning",
        message: "台账没有记录用途和使用地点，导入为\"（台账未记录）\"、校内、非教学。",
      });
    }
    const teaching = supplement?.teaching ?? false;
    const offCampus = supplement?.offCampus ?? false;
    const start = r["借出日期"];
    const due = r["应还日期"];
    const returned = r["归还日期"] || undefined;
    const price = Number(r["单价"]) * 100;
    const approvers = dt01({ valuable: isValuable(price), offCampus }).approvers;

    let status = ledgerStatus[r["状态"]];
    // As of the export date the ledger still said "已借出" for loans past their due date.
    if (status === "OnLoan" && due < DEMO_TODAY) status = "Overdue";

    const submittedAt = atLocal(addDays(start, -1), 9);
    const loan: LoanRow = {
      loanNo: no,
      borrower: r["借用人"],
      status,
      purpose: supplement?.purpose ?? "（台账未记录）",
      teaching,
      offCampus,
      startDate: start,
      dueDate: due,
      submittedAt,
      items: [r["设备编号"]],
      approvals: [],
      audit: [{ action: "import", at: atLocal(DEMO_TODAY, 8), actor: "system", note: r["备注"] || undefined }],
      source: "ledger",
    };

    if (status === "Rejected") {
      loan.approvals.push({ role: "Manager", decision: "Reject", comment: r["备注"] || "（台账未记录原因）", decidedAt: atLocal(addDays(start, -1), 15) });
      issues.push({
        loanNo: no,
        kind: "warning",
        message: `历史拒绝理由"${r["备注"]}"与矛盾 X3 的裁决不一致（以前有过逾期但已归还不构成拒绝理由）。按历史原样导入，不追溯修改。`,
      });
    } else {
      approvers.forEach((role, i) =>
        loan.approvals.push({ role, decision: "Approve", decidedAt: atLocal(addDays(start, -1), 14 + i) }),
      );
    }

    if (status === "OnLoan" || status === "Overdue" || status === "Returned") {
      loan.agreementSignedAt = atLocal(start, 9, 50);
      loan.assetTagsVerifiedAt = atLocal(start, 9, 55);
      loan.checkOutDate = atLocal(start, 10);
    }
    if (status === "Overdue") {
      loan.audit.push({ action: "expire", at: atLocal(addDays(due, 1), 0, 5), actor: "system", before: "OnLoan", after: "Overdue" });
    }
    if (returned) {
      loan.returnDate = returned;
      const late = daysBetween(due, returned);
      const fee = Number(r["罚款"] || 0) * 100;
      if (late > 0) {
        if (/免|不收|算了/.test(r["备注"])) {
          issues.push({
            loanNo: no,
            kind: "warning",
            message: `逾期 ${late} 天，按规则应收 ${late * 10} 元，台账记为 ${fee / 100} 元但备注"${r["备注"]}"（矛盾 X2 之前的做法）。按历史原样导入，不生成逾期费，原备注保留在操作记录中。`,
          });
        } else {
          loan.lateFee = { overdueDays: late, amount: Math.min(late * LATE_FEE_PER_DAY, LATE_FEE_CAP), paidAt: atLocal(returned, 11) };
          if (loan.lateFee.amount !== fee) {
            issues.push({ loanNo: no, kind: "warning", message: `台账罚款 ${fee / 100} 元与规则计算的 ${loan.lateFee.amount / 100} 元不一致。` });
          }
        }
      }
    }
    loans.push(loan);
  }
  return { loans, issues };
}

// ---------------------------------------------------------------- generated history

const PURPOSES = ["课程作业拍摄", "社团活动", "毕业设计", "校园新闻采访", "比赛作品", "课堂展示", "纪录片拍摄", "讲座录制"];
const TEACHING_PURPOSES = ["课堂教学", "教学示范录制", "实践课教学", "校外教学拍摄"];
const REJECT_REASONS = ["用途说明不清楚，请补充后重新申请", "同类设备已满足需求，请改借其他型号", "校外使用缺少带队老师信息"];
const WITHDRAW_NOTES = ["计划有变", "已改借其他设备"];

interface Busy { from: string; to: string } // inclusive date range when an item is out

interface GenContext {
  equipment: EquipmentRow[];
  busy: Map<string, Busy[]>;
  borrowers: PersonRow[];
  /** Per borrower, periods when they had an overdue loan not yet returned (BR-12). */
  overdueWindows: Map<string, Busy[]>;
  nextLoanNo: number;
}

const overlaps = (a: Busy, b: Busy) => a.from <= b.to && b.from <= a.to;
const isFree = (ctx: GenContext, tag: string, r: Busy) => !(ctx.busy.get(tag) ?? []).some((b) => overlaps(b, r));
const occupy = (ctx: GenContext, tag: string, r: Busy) => {
  if (!ctx.busy.has(tag)) ctx.busy.set(tag, []);
  ctx.busy.get(tag)!.push(r);
};
const inOverdueWindow = (ctx: GenContext, borrowerNo: string, date: string) =>
  (ctx.overdueWindows.get(borrowerNo) ?? []).some((w) => w.from <= date && date <= w.to);

/** Daily volume: 15–20 normally, 40–60 in the first two and last two teaching weeks (00-brief). */
function dailyVolume(date: string) {
  const md = date.slice(5);
  const peak = (md >= "09-01" && md <= "09-14") || (md >= "12-15" && md <= "12-28") ||
    (md >= "02-23" && md <= "03-08") || (md >= "06-08" && md <= "06-21");
  const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const winterBreak = md >= "01-15" && md <= "02-20";
  const summer = md >= "07-10" && md <= "08-25";
  if (winterBreak || summer) return int(0, 2);
  if (weekend) return int(1, 4);
  return peak ? int(40, 55) : int(14, 19);
}

function makeLoan(ctx: GenContext, start: string, opts: { future?: boolean } = {}): LoanRow | null {
  const b = pick(ctx.borrowers);
  const isTeacher = b.borrowerType === "Teacher";
  const teaching = isTeacher && chance(0.6);
  const offCampus = chance(0.15);
  const nItems = chance(0.7) ? 1 : chance(0.7) ? 2 : 3;

  // Pick a period first (upper bound by the strictest rule), then free items.
  const wanted: EquipmentRow[] = [];
  for (let tries = 0; wanted.length < nItems && tries < 30; tries++) {
    const e = pick(ctx.equipment);
    if (!wanted.includes(e)) wanted.push(e);
  }
  const valuable = wanted.some((e) => isValuable(e.unitPrice));
  const max = dt02({ borrowerType: b.borrowerType!, teaching, valuable }).maxDays;
  const days = int(1, max);
  const due = addDays(start, days);
  const period = { from: start, to: due };
  const items = wanted.filter((e) => isFree(ctx, e.assetTag, period));
  if (items.length === 0) return null;
  const finalValuable = items.some((e) => isValuable(e.unitPrice));
  const finalMax = dt02({ borrowerType: b.borrowerType!, teaching, valuable: finalValuable }).maxDays;
  if (days > finalMax) return null;

  const submitDay = addDays(start, -int(2, 5)); // decisions happen the day before the start
  const loan: LoanRow = {
    loanNo: `JY-${String(ctx.nextLoanNo++).padStart(4, "0")}`,
    borrower: b.key,
    status: "Requested",
    purpose: teaching ? pick(TEACHING_PURPOSES) : pick(PURPOSES),
    teaching,
    offCampus,
    startDate: start,
    dueDate: due,
    submittedAt: atLocal(submitDay, int(8, 20), int(0, 59)),
    items: items.map((e) => e.assetTag),
    approvals: [],
    audit: [],
    source: "generated",
  };
  loan.audit.push({ action: "submit", at: loan.submittedAt, actor: "borrower", after: "Requested" });
  void opts;
  return loan;
}

function approveAll(loan: LoanRow, approvers: readonly StaffRole[], day: string) {
  approvers.forEach((role, i) => {
    const at = atLocal(day, 10 + i * 2, int(0, 59));
    loan.approvals.push({ role, decision: "Approve", decidedAt: at });
    loan.audit.push({ action: "approve", at, actor: role });
  });
  loan.audit[loan.audit.length - 1].before = "Requested";
  loan.audit[loan.audit.length - 1].after = "Approved";
}

export function generateHistory(people: PersonRow[], equipment: EquipmentRow[], reservedTags: Set<string>) {
  const ctx: GenContext = {
    equipment: equipment.filter((e) => !reservedTags.has(e.assetTag)),
    busy: new Map(),
    borrowers: people.filter((p) => p.kind === "borrower" && /^[ST]-[1-4]\d\d$/.test(p.key)),
    overdueWindows: new Map(),
    nextLoanNo: 1000,
  };
  const loans: LoanRow[] = [];

  // 1) Past and current loans, day by day.
  for (let day = HISTORY_START; day <= DEMO_TODAY; day = addDays(day, 1)) {
    const n = dailyVolume(day);
    for (let k = 0; k < n; k++) {
      let loan: LoanRow | null = null;
      for (let attempt = 0; attempt < 6 && !loan; attempt++) loan = makeLoan(ctx, day);
      if (!loan) continue;
      const decisionDay = addDays(day, -1); // always after submission, which is 2–5 days before the start
      const approvers = dt01({ valuable: loan.items.some((t) => isValuable(equipment.find((e) => e.assetTag === t)!.unitPrice)), offCampus: loan.offCampus }).approvers;

      // Some requests never become loans.
      if (chance(0.05)) {
        loan.status = "Rejected";
        const rejecter: StaffRole = approvers.length > 1 && chance(0.4) ? "DeptHead" : "Manager";
        if (rejecter === "DeptHead") {
          loan.approvals.push({ role: "Manager", decision: "Approve", decidedAt: atLocal(decisionDay, 10) });
          loan.audit.push({ action: "approve", at: atLocal(decisionDay, 10), actor: "Manager" });
        }
        const at = atLocal(decisionDay, 15);
        loan.approvals.push({ role: rejecter, decision: "Reject", comment: pick(REJECT_REASONS), decidedAt: at });
        loan.audit.push({ action: "reject", at, actor: rejecter, before: "Requested", after: "Rejected" });
        loans.push(loan);
        continue;
      }
      if (chance(0.03)) {
        loan.status = "Withdrawn";
        const at = atLocal(decisionDay, 9);
        loan.audit.push({ action: "withdraw", at, actor: "borrower", before: "Requested", after: "Withdrawn", note: pick(WITHDRAW_NOTES) });
        loans.push(loan);
        continue;
      }
      // BR-12: no approval while the borrower has an overdue, unreturned loan.
      if (inOverdueWindow(ctx, loan.borrower, decisionDay)) {
        loan.status = "Rejected";
        const at = atLocal(decisionDay, 15);
        loan.approvals.push({ role: "Manager", decision: "Reject", comment: "有逾期未还设备", decidedAt: at });
        loan.audit.push({ action: "reject", at, actor: "Manager", before: "Requested", after: "Rejected" });
        loans.push(loan);
        continue;
      }

      approveAll(loan, approvers, decisionDay);
      loan.agreementSignedAt = atLocal(day, 9, 40);
      loan.assetTagsVerifiedAt = atLocal(day, 9, 45);
      loan.checkOutDate = atLocal(day, 9, 50);
      loan.audit.push({ action: "checkOut", at: loan.checkOutDate, actor: "Clerk", before: "Approved", after: "OnLoan" });

      // When is it actually returned? Mostly on time, ~8% late, ~3% very late.
      const roll = rnd();
      const lateDays = roll < 0.03 ? int(15, 40) : roll < 0.11 ? int(1, 10) : 0;
      const returnDay = lateDays > 0 ? addDays(loan.dueDate, lateDays) : addDays(loan.dueDate, -int(0, Math.min(3, daysBetween(day, loan.dueDate) - 1 < 0 ? 0 : daysBetween(day, loan.dueDate) - 1)));

      if (returnDay < DEMO_TODAY) {
        loan.status = "Returned";
        loan.returnDate = returnDay;
        if (lateDays > 0) {
          loan.audit.push({ action: "expire", at: atLocal(addDays(loan.dueDate, 1), 0, 5), actor: "system", before: "OnLoan", after: "Overdue" });
          loan.lateFee = { overdueDays: lateDays, amount: Math.min(lateDays * LATE_FEE_PER_DAY, LATE_FEE_CAP), paidAt: atLocal(returnDay, 11) };
          loan.audit.push({ action: "return", at: atLocal(returnDay, 11), actor: pick(["Clerk", "Manager"] as const), before: "Overdue", after: "Returned" });
          const w = { from: addDays(loan.dueDate, 1), to: returnDay };
          if (!ctx.overdueWindows.has(loan.borrower)) ctx.overdueWindows.set(loan.borrower, []);
          ctx.overdueWindows.get(loan.borrower)!.push(w);
        } else {
          loan.audit.push({ action: "return", at: atLocal(returnDay, 11), actor: pick(["Clerk", "Manager"] as const), before: "OnLoan", after: "Returned" });
        }
        for (const t of loan.items) occupy(ctx, t, { from: day, to: returnDay });
      } else if (loan.dueDate < DEMO_TODAY) {
        loan.status = "Overdue";
        loan.audit.push({ action: "expire", at: atLocal(addDays(loan.dueDate, 1), 0, 5), actor: "system", before: "OnLoan", after: "Overdue" });
        for (const t of loan.items) occupy(ctx, t, { from: day, to: "9999-12-31" });
        const w = { from: addDays(loan.dueDate, 1), to: "9999-12-31" };
        if (!ctx.overdueWindows.has(loan.borrower)) ctx.overdueWindows.set(loan.borrower, []);
        ctx.overdueWindows.get(loan.borrower)!.push(w);
      } else {
        loan.status = "OnLoan";
        for (const t of loan.items) occupy(ctx, t, { from: day, to: "9999-12-31" });
      }
      loans.push(loan);
    }
  }

  // 2) Open requests for the coming two weeks: Requested, Approved, Waitlisted.
  const want: Record<"Requested" | "Approved" | "Waitlisted", number> = { Requested: 12, Approved: 10, Waitlisted: 5 };
  const submitDay = addDays(DEMO_TODAY, -1);
  for (const status of ["Approved", "Requested"] as const) {
    let made = 0;
    for (let tries = 0; made < want[status] && tries < 500; tries++) {
      const start = addDays(DEMO_TODAY, int(1, 14));
      const loan = makeLoan(ctx, start);
      if (!loan || inOverdueWindow(ctx, loan.borrower, DEMO_TODAY)) continue;
      loan.submittedAt = atLocal(submitDay, int(8, 20), int(0, 59));
      loan.audit[0].at = loan.submittedAt;
      const approvers = dt01({ valuable: loan.items.some((t) => isValuable(equipment.find((e) => e.assetTag === t)!.unitPrice)), offCampus: loan.offCampus }).approvers;
      if (status === "Approved") {
        approveAll(loan, approvers, DEMO_TODAY);
        // Manager first, then the department head (F10): strictly increasing times.
        const base = int(0, 20);
        loan.approvals.forEach((a, i) => (a.decidedAt = atLocal(DEMO_TODAY, 8, base + i * 15)));
        loan.audit.filter((x) => x.action === "approve").forEach((x, i) => (x.at = loan.approvals[i].decidedAt));
      } else if (approvers.length > 1 && chance(0.5)) {
        // Manager has approved; waiting for the department head (BR-02).
        const at = atLocal(DEMO_TODAY, 8, int(0, 30));
        loan.approvals.push({ role: "Manager", decision: "Approve", decidedAt: at });
        loan.audit.push({ action: "approve", at, actor: "Manager" });
      }
      loan.status = status;
      for (const t of loan.items) occupy(ctx, t, { from: loan.startDate, to: loan.dueDate });
      loans.push(loan);
      made++;
    }
  }
  // Waitlisted: an item that is out during the requested period — either overdue
  // (no end in sight) or on loan with a due date on or after the requested start.
  const outNow = loans.filter((l) => l.status === "OnLoan" || l.status === "Overdue");
  let made = 0;
  for (let tries = 0; made < want.Waitlisted && tries < 500; tries++) {
    const holder = pick(outNow);
    const start = addDays(DEMO_TODAY, int(1, 3));
    if (holder.status === "OnLoan" && holder.dueDate < start) continue;
    const tag = holder.items[0];
    const b = pick(ctx.borrowers);
    if (b.key === holder.borrower || inOverdueWindow(ctx, b.key, DEMO_TODAY)) continue;
    const e = equipment.find((x) => x.assetTag === tag)!;
    const max = dt02({ borrowerType: b.borrowerType!, teaching: false, valuable: isValuable(e.unitPrice) }).maxDays;
    const loan: LoanRow = {
      loanNo: `JY-${String(ctx.nextLoanNo++).padStart(4, "0")}`,
      borrower: b.key,
      status: "Waitlisted",
      purpose: pick(PURPOSES),
      teaching: false,
      offCampus: false,
      startDate: start,
      dueDate: addDays(start, int(1, max)),
      submittedAt: atLocal(submitDay, int(8, 20), int(0, 59)),
      items: [tag],
      approvals: [],
      audit: [],
      source: "generated",
    };
    loan.audit.push({ action: "submit", at: loan.submittedAt, actor: "borrower", after: "Requested" });
    loan.audit.push({ action: "review", at: atLocal(DEMO_TODAY, 8, 40), actor: "Manager", before: "Requested", after: "Waitlisted" });
    loans.push(loan);
    made++;
  }
  // Withdrawn and cancelled ones among the open requests: 1 cancelled by the
  // Manager after approval (T11), 2 withdrawn by the borrower (T5).
  for (let i = 0, tries = 0; i < 3 && tries < 200; tries++) {
    const start = addDays(DEMO_TODAY, int(2, 10));
    const loan = makeLoan(ctx, start);
    if (!loan) continue;
    i++;
    loan.status = "Withdrawn";
    if (i === 1) {
      const approvers = dt01({ valuable: loan.items.some((t) => isValuable(equipment.find((e) => e.assetTag === t)!.unitPrice)), offCampus: loan.offCampus }).approvers;
      approveAll(loan, approvers, addDays(DEMO_TODAY, -1));
      loan.closingReason = "借用人联系设备室表示不再需要";
      loan.audit.push({ action: "cancel", at: atLocal(DEMO_TODAY, 8, 50), actor: "Manager", before: "Approved", after: "Withdrawn", note: loan.closingReason });
    } else {
      loan.audit.push({ action: "withdraw", at: atLocal(DEMO_TODAY, 8, 50), actor: "borrower", before: "Requested", after: "Withdrawn", note: pick(WITHDRAW_NOTES) });
    }
    loans.push(loan);
  }
  void DT01;
  return loans;
}

// ---------------------------------------------------------------- import report

export function writeImportReport(file: string, issues: ImportIssue[], imported: number) {
  const rejected = issues.filter((i) => i.kind === "rejected");
  const warnings = issues.filter((i) => i.kind === "warning");
  const lines = [
    "# 台账导入报告",
    "",
    `导入成功 ${imported} 条，未导入 ${rejected.length} 条，警告 ${warnings.length} 条。`,
    "",
    "## 未导入（需要用户决定）",
    "",
    "| 登记号 | 原因 |",
    "|---|---|",
    ...rejected.map((i) => `| ${i.loanNo} | ${i.message} |`),
    "",
    "## 警告（已导入）",
    "",
    "| 登记号 | 说明 |",
    "|---|---|",
    ...warnings.map((i) => `| ${i.loanNo} | ${i.message} |`),
    "",
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
}

export const hashPassword = () => bcrypt.hashSync(DEMO_PASSWORD, 8);
