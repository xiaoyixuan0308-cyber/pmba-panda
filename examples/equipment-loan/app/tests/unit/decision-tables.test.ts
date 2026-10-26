/** DT-01 and DT-02 (spec/01-decision-tables.md): one test per row, completeness, boundaries. */
import { describe, expect, it } from "vitest";
import { DT01, DT02, dt01, dt02, isValuable } from "@/rules/decision-tables";
import { addDays, daysBetween, workingDaysBetween } from "@/lib/dates";
import { maskPhone } from "@/lib/privacy";

describe("DT-01 approvers (BR-02)", () => {
  it("DT-01 R1 ordinary item, on campus → Manager only", () => expect(dt01({ valuable: false, offCampus: false }).approvers).toEqual(["Manager"]));
  it("DT-01 R2 valuable item → Manager then DeptHead (on or off campus)", () => {
    expect(dt01({ valuable: true, offCampus: false })).toMatchObject({ rule: "R2", approvers: ["Manager", "DeptHead"] });
    expect(dt01({ valuable: true, offCampus: true })).toMatchObject({ rule: "R2" });
  });
  it("DT-01 R3 ordinary item, off campus → Manager then DeptHead", () => expect(dt01({ valuable: false, offCampus: true })).toMatchObject({ rule: "R3", approvers: ["Manager", "DeptHead"] }));
  it("DT-01 is complete and without overlaps", () => {
    for (const valuable of [true, false]) for (const offCampus of [true, false]) expect(() => dt01({ valuable, offCampus })).not.toThrow();
    expect(DT01).toHaveLength(3);
  });
  it("boundary: exactly 5000.00 is not valuable; 5000.01 is", () => {
    expect(isValuable(500000)).toBe(false);
    expect(isValuable(500001)).toBe(true);
  });
});

describe("DT-02 maximum days (BR-06)", () => {
  const max = (borrowerType: "Student" | "Teacher", teaching: boolean, valuable: boolean) => dt02({ borrowerType, teaching, valuable });
  it("DT-02 R1 student, ordinary item → 14 days", () => expect(max("Student", false, false)).toMatchObject({ rule: "R1", maxDays: 14 }));
  it("DT-02 R2 student, valuable item → 7 days", () => expect(max("Student", true, true)).toMatchObject({ rule: "R2", maxDays: 7 }));
  it("DT-02 R3 teacher, teaching, ordinary item → 30 days", () => expect(max("Teacher", true, false)).toMatchObject({ rule: "R3", maxDays: 30 }));
  it("DT-02 R4 teacher, teaching, valuable item → 14 days", () => expect(max("Teacher", true, true)).toMatchObject({ rule: "R4", maxDays: 14 }));
  it("DT-02 R5 teacher, not teaching, ordinary item → 14 days", () => expect(max("Teacher", false, false)).toMatchObject({ rule: "R5", maxDays: 14 }));
  it("DT-02 R6 teacher, not teaching, valuable item → 7 days", () => expect(max("Teacher", false, true)).toMatchObject({ rule: "R6", maxDays: 7 }));
  it("DT-02 is complete: students match regardless of teaching", () => {
    for (const borrowerType of ["Student", "Teacher"] as const)
      for (const teaching of [true, false]) for (const valuable of [true, false]) expect(() => dt02({ borrowerType, teaching, valuable })).not.toThrow();
    expect(DT02).toHaveLength(6);
  });
});

describe("dates", () => {
  it("due = start + days; JY-0905 Sep 12 → Oct 10 is 28 days", () => {
    expect(addDays("2026-11-02", 7)).toBe("2026-11-09");
    expect(daysBetween("2026-09-12", "2026-10-10")).toBe(28);
  });
  it("working days skip weekends (BR-09)", () => {
    expect(workingDaysBetween("2026-11-06", "2026-11-09")).toBe(1); // Fri → Mon
    expect(workingDaysBetween("2026-11-02", "2026-11-04")).toBe(2);
    expect(workingDaysBetween("2026-11-07", "2026-11-08")).toBe(0);
  });
  it("phone masking keeps the first 3 and last 4 digits (C-01)", () => expect(maskPhone("10000001234")).toBe("100****1234"));
});
