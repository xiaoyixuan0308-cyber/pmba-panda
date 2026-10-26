/**
 * Decision tables from spec/01-decision-tables.md, written as data
 * (references/uml-to-code-mapping.md section 7.1). Code looks rows up;
 * it never re-implements the conditions with if/else.
 */
import type { BorrowerType, StaffRole } from "@/db/schema";

/** DT-01 / BR-02: unit price strictly above 5000.00 counts as valuable. */
export const VALUABLE_THRESHOLD_CENTS = 500000;
export const isValuable = (unitPriceCents: number) => unitPriceCents > VALUABLE_THRESHOLD_CENTS;

type Any = "-";

// BR-02: approvers (DT-01)
export const DT01 = [
  { rule: "R1", valuable: false, offCampus: false, approvers: ["Manager"] },
  { rule: "R2", valuable: true, offCampus: "-", approvers: ["Manager", "DeptHead"] },
  { rule: "R3", valuable: false, offCampus: true, approvers: ["Manager", "DeptHead"] },
] as const satisfies readonly {
  rule: string;
  valuable: boolean | Any;
  offCampus: boolean | Any;
  approvers: readonly StaffRole[];
}[];

// BR-06: maximum loan period in days (DT-02)
export const DT02 = [
  { rule: "R1", borrowerType: "Student", teaching: "-", valuable: false, maxDays: 14 },
  { rule: "R2", borrowerType: "Student", teaching: "-", valuable: true, maxDays: 7 },
  { rule: "R3", borrowerType: "Teacher", teaching: true, valuable: false, maxDays: 30 },
  { rule: "R4", borrowerType: "Teacher", teaching: true, valuable: true, maxDays: 14 },
  { rule: "R5", borrowerType: "Teacher", teaching: false, valuable: false, maxDays: 14 },
  { rule: "R6", borrowerType: "Teacher", teaching: false, valuable: true, maxDays: 7 },
] as const satisfies readonly {
  rule: string;
  borrowerType: BorrowerType;
  teaching: boolean | Any;
  valuable: boolean;
  maxDays: number;
}[];

const matches = (cell: unknown, value: unknown) => cell === "-" || cell === value;

/** Exactly one row must match; anything else is a defect in the table. */
function single<T extends { rule: string }>(rows: readonly T[], table: string): T {
  if (rows.length !== 1) {
    throw new Error(`${table}: expected exactly one matching row, got ${rows.map((r) => r.rule).join(",") || "none"}`);
  }
  return rows[0];
}

export function dt01(input: { valuable: boolean; offCampus: boolean }) {
  return single(
    DT01.filter((r) => matches(r.valuable, input.valuable) && matches(r.offCampus, input.offCampus)),
    "DT-01",
  );
}

export function dt02(input: { borrowerType: BorrowerType; teaching: boolean; valuable: boolean }) {
  return single(
    DT02.filter(
      (r) =>
        r.borrowerType === input.borrowerType &&
        matches(r.teaching, input.teaching) &&
        r.valuable === input.valuable,
    ),
    "DT-02",
  );
}
