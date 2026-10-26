/**
 * Stage 5a checks: the demo data must agree with the specification.
 * Seed data is written directly in its final state (see scripts/demo-data.ts),
 * so these tests are what proves it is consistent with the state machine,
 * the decision tables, the business rules and the ledger.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { dt01, dt02, isValuable } from "@/rules/decision-tables";
import { addDays, daysBetween } from "@/lib/dates";
import { LOAN_STATUSES } from "@/db/schema";

const TODAY = "2026-10-08";
const root = path.resolve(__dirname, "../..");
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seed-")), "test.db");
let db: Database.Database;

type Loan = {
  id: number; loan_no: string; borrower_id: number; status: string; teaching: number; off_campus: number;
  start_date: string; due_date: string; submitted_at: number; asset_tags_verified_at: number | null;
  check_out_date: number | null; return_date: string | null; closing_reason: string | null;
};
let loans: Loan[];
const all = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;

beforeAll(() => {
  // SEED_DB lets a reviewer point the checks at an existing database (used to
  // confirm the checks catch deliberately broken data); otherwise build a fresh one.
  if (process.env.SEED_DB) {
    db = new Database(process.env.SEED_DB, { readonly: true });
  } else {
    execSync("npx tsx scripts/setup.ts", { cwd: root, env: { ...process.env, DB_FILE: dbFile }, stdio: "pipe" });
    db = new Database(dbFile, { readonly: true });
  }
  loans = all<Loan>("select * from loans");
});

const itemsOf = (loanId: number) =>
  all<{ asset_tag: string; unit_price: number }>(
    "select e.asset_tag, e.unit_price from loan_items li join equipment e on e.id = li.equipment_id where li.loan_id = ?", loanId);
const borrowerOf = (id: number) => one<{ borrower_no: string; borrower_type: "Student" | "Teacher" }>("select borrower_no, borrower_type from people where id = ?", id);
const approvalsOf = (loanId: number) =>
  all<{ approver_role: string; decision: string; comment: string | null; decided_at: number }>("select * from approvals where loan_id = ? order by decided_at", loanId);

describe("volumes (build plan 5a, NFUS4)", () => {
  it("has 320 items of equipment, 40 of them valuable", () => {
    const eq = all<{ unit_price: number }>("select unit_price from equipment");
    expect(eq).toHaveLength(320);
    expect(eq.filter((e) => isValuable(e.unit_price))).toHaveLength(40);
  });
  it("has one item priced exactly 5000.00, which is not valuable (DT-01 boundary)", () => {
    const at = all<{ unit_price: number }>("select unit_price from equipment where unit_price = 500000");
    expect(at.length).toBeGreaterThanOrEqual(1);
    expect(isValuable(at[0].unit_price)).toBe(false);
  });
  it("has about 5000 loans", () => {
    expect(loans.length).toBeGreaterThan(4500);
    expect(loans.length).toBeLessThan(5500);
  });
  it("has at least 3 loans in every status", () => {
    for (const s of LOAN_STATUSES) expect(loans.filter((l) => l.status === s).length, s).toBeGreaterThanOrEqual(3);
  });
});

describe("structure (class diagram)", () => {
  it("every loan includes at least one item (Loan–Equipment 1..*)", () => {
    const empty = all("select id from loans l where not exists (select 1 from loan_items li where li.loan_id = l.id)");
    expect(empty).toEqual([]);
  });
  it("valid status values only", () => {
    for (const l of loans) expect(LOAN_STATUSES).toContain(l.status);
  });
});

describe("dates and statuses agree as of the demo today (state machine)", () => {
  it("Returned: returned before today, after the start, checked out", () => {
    for (const l of loans.filter((x) => x.status === "Returned")) {
      expect(l.return_date, l.loan_no).not.toBeNull();
      expect(l.return_date! < TODAY, l.loan_no).toBe(true);
      expect(l.return_date! > l.start_date, l.loan_no).toBe(true);
      expect(l.check_out_date, l.loan_no).not.toBeNull();
    }
  });
  it("OnLoan: started, not returned, not yet past due", () => {
    for (const l of loans.filter((x) => x.status === "OnLoan")) {
      expect(l.start_date <= TODAY && l.due_date >= TODAY && l.return_date === null, l.loan_no).toBe(true);
    }
  });
  it("Overdue: past due and not returned (BR-07)", () => {
    for (const l of loans.filter((x) => x.status === "Overdue")) {
      expect(l.due_date < TODAY && l.return_date === null, l.loan_no).toBe(true);
    }
  });
  it("no OnLoan loan is past its due date (would have been marked overdue)", () => {
    expect(loans.filter((l) => l.status === "OnLoan" && l.due_date < TODAY)).toEqual([]);
  });
  it("Requested, Approved and Waitlisted loans have not been checked out", () => {
    for (const l of loans.filter((x) => ["Requested", "Approved", "Waitlisted"].includes(x.status))) {
      expect(l.check_out_date, l.loan_no).toBeNull();
      expect(l.start_date > TODAY, l.loan_no).toBe(true);
    }
  });
  it("checked-out loans have a signed agreement and verified asset tags before check-out (BR-05, BR-11)", () => {
    for (const l of loans.filter((x) => ["OnLoan", "Overdue", "Returned"].includes(x.status))) {
      const a = one<{ signed_at: number } | undefined>("select signed_at from agreements where loan_id = ?", l.id);
      expect(a, l.loan_no).toBeDefined();
      expect(a!.signed_at <= l.check_out_date!, l.loan_no).toBe(true);
      expect(l.asset_tags_verified_at !== null && l.asset_tags_verified_at <= l.check_out_date!, l.loan_no).toBe(true);
    }
  });
  it("cancelled loans (T11) carry a reason (change 001)", () => {
    const cancelled = all<{ object_id: number }>("select object_id from audit_entries where action = 'cancel'");
    expect(cancelled.length).toBeGreaterThan(0);
    for (const c of cancelled) expect(loans.find((l) => l.id === c.object_id)!.closing_reason).toBeTruthy();
  });
});

describe("equipment is never in two places at once", () => {
  it("no overlapping occupation of any item", () => {
    const end = (l: Loan) =>
      l.status === "Returned" ? l.return_date!
        : l.status === "Overdue" ? "9999-12-31"
        : l.due_date; // OnLoan (expected back by due), Approved, Requested
    const occupying = loans.filter((l) => ["Returned", "OnLoan", "Overdue", "Approved", "Requested"].includes(l.status));
    const byItem = new Map<string, { from: string; to: string; no: string }[]>();
    for (const l of occupying) {
      for (const it of itemsOf(l.id)) {
        if (!byItem.has(it.asset_tag)) byItem.set(it.asset_tag, []);
        byItem.get(it.asset_tag)!.push({ from: l.start_date, to: end(l), no: l.loan_no });
      }
    }
    const clashes: string[] = [];
    for (const [tag, rs] of byItem) {
      rs.sort((a, b) => a.from.localeCompare(b.from));
      for (let i = 1; i < rs.length; i++) if (rs[i].from <= rs[i - 1].to) clashes.push(`${tag}: ${rs[i - 1].no} / ${rs[i].no}`);
    }
    expect(clashes).toEqual([]);
  });
  it("every waitlisted loan really is waiting for an item that is out (BR-03)", () => {
    for (const l of loans.filter((x) => x.status === "Waitlisted")) {
      const blocked = itemsOf(l.id).some((it) =>
        all<{ status: string; due_date: string }>(
          `select l.status, l.due_date from loans l join loan_items li on li.loan_id = l.id join equipment e on e.id = li.equipment_id
           where e.asset_tag = ? and l.id <> ? and l.status in ('OnLoan','Overdue')`, it.asset_tag, l.id,
        ).some((o) => o.status === "Overdue" || o.due_date >= l.start_date));
      expect(blocked, l.loan_no).toBe(true);
    }
  });
});

describe("decision tables", () => {
  it("loan periods never exceed DT-02 (BR-06)", () => {
    for (const l of loans) {
      const b = borrowerOf(l.borrower_id);
      const valuable = itemsOf(l.id).some((i) => isValuable(i.unit_price));
      const max = dt02({ borrowerType: b.borrower_type, teaching: !!l.teaching, valuable }).maxDays;
      expect(daysBetween(l.start_date, l.due_date) <= max, `${l.loan_no} ${b.borrower_type} ${valuable}`).toBe(true);
    }
  });
  it("approved and later loans have exactly the DT-01 approvers, all approving (BR-02)", () => {
    for (const l of loans.filter((x) => ["Approved", "OnLoan", "Overdue", "Returned"].includes(x.status))) {
      const valuable = itemsOf(l.id).some((i) => isValuable(i.unit_price));
      const want = [...dt01({ valuable, offCampus: !!l.off_campus }).approvers].sort();
      const got = approvalsOf(l.id);
      expect(got.map((a) => a.approver_role).sort(), l.loan_no).toEqual(want);
      expect(got.every((a) => a.decision === "Approve"), l.loan_no).toBe(true);
    }
  });
  it("Manager decides before the Department Head (F10)", () => {
    for (const l of loans) {
      const a = approvalsOf(l.id);
      const m = a.find((x) => x.approver_role === "Manager");
      const d = a.find((x) => x.approver_role === "DeptHead");
      if (d) expect(m && m.decided_at < d.decided_at, l.loan_no).toBeTruthy();
    }
  });
  it("approvals happen after submission and before the start", () => {
    for (const l of loans) for (const a of approvalsOf(l.id)) {
      expect(a.decided_at > l.submitted_at, l.loan_no).toBe(true);
    }
  });
  it("every rejected loan has exactly one rejection, with a reason (BR-04)", () => {
    for (const l of loans.filter((x) => x.status === "Rejected")) {
      const rejects = approvalsOf(l.id).filter((a) => a.decision === "Reject");
      expect(rejects, l.loan_no).toHaveLength(1);
      expect(rejects[0].comment?.trim(), l.loan_no).toBeTruthy();
    }
  });
});

describe("late fees (BR-10)", () => {
  const exempt = new Set(["JY-0909"]); // historical waiver, recorded in data/import-report.md (X2)
  it("late returns have a paid fee of 10/day capped at 200; on-time returns have none", () => {
    for (const l of loans.filter((x) => x.status === "Returned" && !exempt.has(x.loan_no))) {
      const late = daysBetween(l.due_date, l.return_date!);
      const fee = one<{ overdue_days: number; amount: number; paid_at: number | null } | undefined>("select * from late_fees where loan_id = ?", l.id);
      if (late > 0) {
        expect(fee, l.loan_no).toBeDefined();
        expect(fee!.overdue_days, l.loan_no).toBe(late);
        expect(fee!.amount, l.loan_no).toBe(Math.min(late * 1000, 20000));
        expect(fee!.paid_at, l.loan_no).not.toBeNull();
      } else {
        expect(fee, l.loan_no).toBeUndefined();
      }
    }
  });
  it("the cap is exercised by at least one loan", () => {
    expect(one<{ n: number }>("select count(*) n from late_fees where amount = 20000").n).toBeGreaterThan(0);
  });
  it("only returned loans have late fees", () => {
    expect(all("select f.id from late_fees f join loans l on l.id = f.loan_id where l.status <> 'Returned'")).toEqual([]);
  });
});

describe("BR-12 in the history", () => {
  it("no loan was approved while its borrower had an overdue, unreturned loan", () => {
    const byBorrower = new Map<number, Loan[]>();
    for (const l of loans) {
      if (!byBorrower.has(l.borrower_id)) byBorrower.set(l.borrower_id, []);
      byBorrower.get(l.borrower_id)!.push(l);
    }
    const violations: string[] = [];
    for (const l of loans) {
      const finalApproval = approvalsOf(l.id).filter((a) => a.decision === "Approve").at(-1);
      if (!finalApproval || l.status === "Rejected") continue;
      const day = new Date(finalApproval.decided_at * 1000 + 8 * 3600_000).toISOString().slice(0, 10);
      for (const o of byBorrower.get(l.borrower_id)!) {
        if (o.id === l.id || !["Returned", "Overdue"].includes(o.status)) continue;
        const overdueFrom = addDays(o.due_date, 1);
        const overdueTo = o.return_date ?? "9999-12-31";
        if (o.return_date && o.return_date <= o.due_date) continue;
        if (overdueFrom <= day && day <= overdueTo) violations.push(`${l.loan_no} approved ${day} while ${o.loan_no} overdue`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("ledger import agrees with spec/00-materials/M1", () => {
  const csv = fs.readFileSync(path.resolve(root, "../spec/00-materials/M1-loan-register.csv"), "utf8").trim().split("\n").slice(1).map((r) => r.split(","));
  it("imports every row that has dates, exactly as recorded", () => {
    for (const r of csv) {
      const [no, who, , tag, , , start, due, ret, , fine] = r;
      const l = loans.find((x) => x.loan_no === no);
      if (!start) {
        expect(l, no).toBeUndefined();
        continue;
      }
      expect(l, no).toBeDefined();
      expect(borrowerOf(l!.borrower_id).borrower_no).toBe(who);
      expect(itemsOf(l!.id).map((i) => i.asset_tag)).toEqual([tag]);
      expect([l!.start_date, l!.due_date, l!.return_date ?? ""]).toEqual([start, due, ret]);
      if (fine && no !== "JY-0909") {
        expect(one<{ amount: number }>("select amount from late_fees where loan_id = ?", l!.id).amount).toBe(Number(fine) * 100);
      }
    }
  });
  it("rows without dates are listed in the import report, not invented", () => {
    const file = path.join(root, "data", "import-report.md");
    const text = fs.readFileSync(file, "utf8");
    for (const r of csv.filter((x) => !x[6])) expect(text).toContain(r[0]);
  });
});

describe("golden case starting data (golden-cases.md)", () => {
  const borrowerId = (no: string) => one<{ id: number }>("select id from people where borrower_no = ?", no).id;
  const loansOf = (no: string) => loans.filter((l) => l.borrower_id === borrowerId(no));
  const occupyingAfter = (tag: string, from: string) =>
    all<{ loan_no: string }>(
      `select l.loan_no from loans l join loan_items li on li.loan_id = l.id join equipment e on e.id = li.equipment_id
       where e.asset_tag = ? and l.status in ('OnLoan','Overdue','Approved','Requested','Waitlisted')
         and (l.status = 'Overdue' or l.due_date >= ?)`, tag, from);

  it("GC-03: S-014's only open loan is JY-0905, overdue since 13 September", () => {
    const open = loansOf("S-014").filter((l) => !["Returned", "Rejected", "Withdrawn"].includes(l.status));
    expect(open.map((l) => [l.loan_no, l.status, l.due_date])).toEqual([["JY-0905", "Overdue", "2026-09-12"]]);
    expect(occupyingAfter("TRI-0040", TODAY)).toEqual([]);
  });
  it("GC-05: S-022 has no open loans and JY-0903 was returned late with a 50.00 fee", () => {
    expect(loansOf("S-022").filter((l) => !["Returned", "Rejected", "Withdrawn"].includes(l.status))).toEqual([]);
    const l = loans.find((x) => x.loan_no === "JY-0903")!;
    expect(l.status).toBe("Returned");
    expect(one<{ amount: number }>("select amount from late_fees where loan_id = ?", l.id).amount).toBe(5000);
    expect(occupyingAfter("LGT-0007", TODAY)).toEqual([]);
  });
  it("GC-02: JY-0902 matches the case (teacher, valuable, off campus, two approvals, returned on time)", () => {
    const l = loans.find((x) => x.loan_no === "JY-0902")!;
    expect([l.status, l.start_date, l.due_date, l.return_date, !!l.teaching, !!l.off_campus]).toEqual(["Returned", "2026-09-02", "2026-09-16", "2026-09-15", true, true]);
    expect(approvalsOf(l.id).map((a) => a.approver_role)).toEqual(["Manager", "DeptHead"]);
  });
  it("GC-01 and GC-04: the borrowers have no loans and the equipment is free from 8 October on", () => {
    for (const no of ["S-060", "S-061", "S-062"]) expect(loansOf(no), no).toEqual([]);
    for (const tag of ["AV-0103", "DRN-0002"]) expect(occupyingAfter(tag, TODAY), tag).toEqual([]);
  });
});

describe("accounts and privacy (C-06, NFUS3)", () => {
  it("five demo accounts exist with the right roles", () => {
    const get = (email: string) => one<{ kind: string; staff_role: string | null; borrower_type: string | null }>("select kind, staff_role, borrower_type from people where email = ?", email);
    expect(get("student@demo.local")).toMatchObject({ kind: "borrower", borrower_type: "Student" });
    expect(get("teacher@demo.local")).toMatchObject({ kind: "borrower", borrower_type: "Teacher" });
    expect(get("clerk@demo.local")).toMatchObject({ kind: "staff", staff_role: "Clerk" });
    expect(get("manager@demo.local")).toMatchObject({ kind: "staff", staff_role: "Manager" });
    expect(get("depthead@demo.local")).toMatchObject({ kind: "staff", staff_role: "DeptHead" });
  });
  it("all phone numbers are in the reserved fictional range", () => {
    expect(all("select phone from people where phone not like '1000000%'")).toEqual([]);
  });
  it("no passwords are stored in plain text", () => {
    expect(all("select id from people where password_hash not like '$2%'")).toEqual([]);
  });
});

describe("audit trail (NFUS2)", () => {
  it("every loan has a submit or import entry", () => {
    const missing = all("select id from loans l where not exists (select 1 from audit_entries a where a.object_type='Loan' and a.object_id=l.id and a.action in ('submit','import'))");
    expect(missing).toEqual([]);
  });
  it("every generated returned loan has a return entry, every overdue one an expire entry", () => {
    const gen = (s: string) => loans.filter((l) => l.status === s && !/^JY-09\d\d$/.test(l.loan_no));
    const has = (id: number, action: string) => !!one("select 1 x from audit_entries where object_id = ? and action = ?", id, action);
    for (const l of gen("Returned")) expect(has(l.id, "return"), l.loan_no).toBe(true);
    for (const l of loans.filter((x) => x.status === "Overdue")) expect(has(l.id, "expire"), l.loan_no).toBe(true);
  });
});
