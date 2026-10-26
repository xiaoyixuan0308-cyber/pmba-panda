/**
 * Checks on the code itself: the permission table agrees with the state
 * machine, status is written in one place only, nothing deletes data, and
 * the transition table matches the diagram.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/auth/permissions";
import { TRANSITIONS } from "@/domain/loan/transitions";
import { LOAN_STATUSES } from "@/db/schema";

const src = path.resolve(__dirname, "../../src");
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));
const code = files(src).map((f) => ({ f: path.relative(src, f), text: fs.readFileSync(f, "utf8") }));

describe("one place changes status", () => {
  it("only domain/loan/transition.ts writes loans.status", () => {
    const writers = code.filter(({ text }) => /\.update\(loans\)[\s\S]{0,200}?status\s*[:=]/.test(text) || /status:\s*t\.to/.test(text)).map((c) => c.f);
    expect(writers).toEqual(["domain/loan/transition.ts"]);
    const rawSql = code.filter(({ text }) => /update\s+loans\s+set[^;]*status/i.test(text)).map((c) => c.f);
    expect(rawSql).toEqual([]);
  });
  it("nothing in the app deletes rows (C-02)", () => {
    // database deletes only; cookies().delete() at logout is not data
    expect(code.filter(({ text }) => /\.delete\((?!COOKIE\))|delete\s+from/i.test(text)).map((c) => c.f)).toEqual([]);
  });
  it("nothing updates the audit trail (NFUS2)", () => {
    expect(code.filter(({ text }) => /update\(auditEntries\)/.test(text)).map((c) => c.f)).toEqual([]);
  });
});

describe("transition table agrees with the diagram", () => {
  const puml = fs.readFileSync(path.resolve(__dirname, "../../../spec/models/06-state-loan.puml"), "utf8");
  const arrows = [...puml.matchAll(/^(\w+) --> (\w+) : (T\d+) (\w+)(?: \[([^\]]*)\])?/gm)].map((m) => ({ from: m[1], to: m[2], id: m[3], trigger: m[4], guard: m[5] ?? "" }));
  it("every arrow T1–T11 is in the table with the same states and trigger, and nothing extra", () => {
    expect(arrows.map((a) => a.id).sort()).toEqual(Object.keys(TRANSITIONS).sort());
    for (const a of arrows) expect(TRANSITIONS[a.id as keyof typeof TRANSITIONS]).toMatchObject({ from: a.from, to: a.to, trigger: a.trigger });
  });
  it("guards on the diagram appear in the table", () => {
    const names: Record<string, string> = { "not equipmentAvailable": "notEquipmentAvailable", "after dueDate": "afterDueDate" };
    for (const a of arrows.filter((x) => x.guard)) {
      const expected = a.guard.split("&&").map((g) => names[g.trim()] ?? g.trim());
      expect(TRANSITIONS[a.id as keyof typeof TRANSITIONS].guards).toEqual(expect.arrayContaining(expected));
    }
  });
  it("every status value exists on the diagram", () => {
    for (const s of LOAN_STATUSES) expect(puml).toMatch(new RegExp(`\\b${s}\\b`));
  });
});

describe("permissions agree with the state machine and the CRUD matrix", () => {
  const opFor: Record<string, keyof typeof PERMISSIONS> = {
    T1: "loan.review", T3: "loan.approve", T4: "loan.reject", T5: "loan.withdraw", T6: "loan.withdraw",
    T7: "loan.checkOut", T8: "loan.runDailyChecks", T9: "loan.return", T10: "loan.return", T11: "loan.cancel",
  };
  it("roles allowed to fire a transition are the roles allowed the matching operation", () => {
    for (const [id, op] of Object.entries(opFor)) {
      const t = TRANSITIONS[id as keyof typeof TRANSITIONS];
      for (const r of t.roles) expect(PERMISSIONS[op] as readonly string[]).toContain(r);
    }
  });
  it("the CRUD matrix rows in spec/01-crud-matrix.md are reflected", () => {
    const m = fs.readFileSync(path.resolve(__dirname, "../../../spec/01-crud-matrix.md"), "utf8");
    expect(m).toMatch(/LateFee 逾期费 \| R\(本人\) \| R、U\(登记已缴\) \| R、U\(登记已缴\)/);
    expect(PERMISSIONS["loan.return"]).toEqual(["Clerk", "Manager"]);
    expect(PERMISSIONS["audit.read"]).toEqual(["Manager", "DeptHead"]);
    expect(PERMISSIONS["loan.cancel"]).toEqual(["Manager"]);
    expect(PERMISSIONS["loan.checkOut"]).toEqual(["Clerk"]);
  });
});
