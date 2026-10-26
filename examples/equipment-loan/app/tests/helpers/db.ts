import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, or } from "drizzle-orm";
import { inject } from "vitest";
import { openDb, type Db } from "@/db/open";
import { auditEntries, equipment, loans, notifications, people, settings } from "@/db/schema";
import { actorFor, makeCtx, SYSTEM, type Ctx } from "@/domain/context";
import type { AssetRegistry } from "@/adapters/asset-registry";
import { approve, checkOut, signAgreement, submitRequest } from "@/domain/loan/service";

export function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loan-test-"));
  const file = path.join(dir, "test.db");
  fs.copyFileSync(inject("templateDb"), file);
  return openDb(file);
}

export function setToday(db: Db, iso: string) {
  db.update(settings).set({ value: iso }).where(eq(settings.key, "simulatedToday")).run();
}
export function setSetting(db: Db, key: string, value: string) {
  db.update(settings).set({ value }).where(eq(settings.key, key)).run();
}

/** Look a person up by borrower or staff number (S-060, M-001 …). */
export function personId(db: Db, code: string) {
  const p = db.select({ id: people.id }).from(people).where(or(eq(people.borrowerNo, code), eq(people.staffNo, code))).get();
  if (!p) throw new Error(`no person ${code}`);
  return p.id;
}
export const equipmentId = (db: Db, tag: string) => db.select().from(equipment).where(eq(equipment.assetTag, tag)).get()!.id;
export const loanByNo = (db: Db, no: string) => db.select().from(loans).where(eq(loans.loanNo, no)).get()!;
export const loanById = (db: Db, id: number) => db.select().from(loans).where(eq(loans.id, id)).get()!;

/** A context acting as `code` ("System" for the system) on the current simulated date. */
export function as(db: Db, code: string, opts: { registry?: AssetRegistry; time?: [number, number] } = {}): Ctx {
  const actor = code === "System" ? SYSTEM : actorFor(db, personId(db, code));
  return makeCtx(db, actor, { time: [10, 0], ...opts });
}

export const notesFor = (db: Db, code: string, loanId?: number) =>
  db.select().from(notifications).where(eq(notifications.recipientId, personId(db, code))).all().filter((n) => loanId === undefined || n.loanId === loanId);

export const auditFor = (db: Db, loanId: number) =>
  db.select().from(auditEntries).where(eq(auditEntries.objectId, loanId)).all().filter((a) => a.objectType === "Loan");

/** Expect a DomainError with this code (and message fragment). */
export function failsWith(fn: () => unknown, code: string, fragment?: string) {
  try {
    fn();
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code !== code) throw new Error(`expected ${code}, got ${err.code ?? "error"}: ${err.message}`);
    if (fragment && !err.message.includes(fragment)) throw new Error(`message "${err.message}" lacks "${fragment}"`);
    return err;
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

export interface Req {
  tags: string[];
  start: string;
  due: string;
  offCampus?: boolean;
  teaching?: boolean;
  purpose?: string;
}
export function submit(db: Db, borrower: string, r: Req) {
  return submitRequest(as(db, borrower), {
    equipmentIds: r.tags.map((t) => equipmentId(db, t)),
    purpose: r.purpose ?? "课程作业拍摄",
    offCampus: r.offCampus ?? false,
    teaching: r.teaching ?? false,
    startDate: r.start,
    dueDate: r.due,
  });
}

/** Drive a fresh request to Approved (Manager, then DeptHead when DT-01 needs it). */
export function approveFully(db: Db, loanId: number) {
  let l = approve(as(db, "M-001"), loanId);
  if (l.status === "Requested") l = approve(as(db, "D-001"), loanId);
  return l;
}
export function toOnLoan(db: Db, borrower: string, loanId: number) {
  approveFully(db, loanId);
  signAgreement(as(db, borrower), loanId);
  return checkOut(as(db, "C-001"), loanId);
}
