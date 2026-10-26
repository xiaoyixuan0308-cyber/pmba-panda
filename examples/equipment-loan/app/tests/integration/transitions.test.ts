/**
 * The state machine (spec/models/06-state-loan.puml): every transition once,
 * every guard failing once, terminal states, wrong roles, and the audit trail.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { lateFees, loans } from "@/db/schema";
import { TRANSITIONS, TERMINAL } from "@/domain/loan/transitions";
import { applyTransition } from "@/domain/loan/transition";
import { approve, cancel, checkOut, moveToWaitlist, recordReturn, reject, signAgreement, withdraw } from "@/domain/loan/service";
import { runDailyChecks } from "@/domain/loan/daily";
import { approveFully, as, auditFor, failsWith, freshDb, loanById, loanByNo, notesFor, setSetting, setToday, submit, toOnLoan } from "../helpers/db";

let db: Db;
beforeEach(() => {
  db = freshDb().db;
  setToday(db, "2026-11-01");
});

const occupyDrone = () => {
  const held = submit(db, "S-062", { tags: ["DRN-0002"], start: "2026-11-02", due: "2026-11-06" });
  approveFully(db, held.loanId);
  return held.loanId;
};

describe("each transition succeeds", () => {
  it("T1 review: short equipment → Waitlisted, borrower notified (entry action)", () => {
    occupyDrone();
    const { loanId } = submit(db, "S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    expect(moveToWaitlist(as(db, "M-001"), loanId).status).toBe("Waitlisted");
    expect(notesFor(db, "S-061", loanId).filter((n) => n.message.includes("等待名单"))).toHaveLength(1);
  });

  it("T2 equipmentReleased: cancelling the holder sends the waiting loan back to Requested, Manager notified once", () => {
    const holder = occupyDrone();
    const { loanId } = submit(db, "S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    moveToWaitlist(as(db, "M-001"), loanId);
    const before = notesFor(db, "M-001", loanId).length;
    cancel(as(db, "M-001"), holder, "借用人不再需要");
    expect(loanById(db, loanId).status).toBe("Requested");
    expect(notesFor(db, "M-001", loanId).length - before).toBe(1);
    const a = auditFor(db, loanId).find((x) => x.action === "T2 equipmentReleased")!;
    expect(a.actorId).toBeNull(); // done by the system
  });

  it("T3 approve: last required approval → Approved, borrower notified", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    expect(approve(as(db, "M-001"), loanId).status).toBe("Approved");
    expect(notesFor(db, "S-060", loanId).some((n) => n.message.includes("已批准"))).toBe(true);
  });

  it("T4 reject: → Rejected with reason recorded as an Approval and sent to the borrower", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    expect(reject(as(db, "M-001"), loanId, "课程已取消").status).toBe("Rejected");
    expect(notesFor(db, "S-060", loanId).some((n) => n.message.includes("课程已取消"))).toBe(true);
  });

  it("T5 withdraw from Requested", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    expect(withdraw(as(db, "S-060"), loanId).status).toBe("Withdrawn");
  });

  it("T6 withdraw from Waitlisted", () => {
    occupyDrone();
    const { loanId } = submit(db, "S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    moveToWaitlist(as(db, "M-001"), loanId);
    expect(withdraw(as(db, "S-061"), loanId).status).toBe("Withdrawn");
    expect(auditFor(db, loanId).at(-1)!.action).toBe("T6 withdraw");
  });

  it("T7 checkOut: → OnLoan with check-out time and tag verification time", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    const l = toOnLoan(db, "S-060", loanId);
    expect(l.status).toBe("OnLoan");
    expect(l.checkOutDate).toBeInstanceOf(Date);
    expect(l.assetTagsVerifiedAt).toBeInstanceOf(Date);
  });

  it("T8 expire: the daily check the day after the due date → Overdue", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    toOnLoan(db, "S-060", loanId);
    setToday(db, "2026-11-10");
    expect(runDailyChecks(as(db, "M-001")).expired).toContain(loanById(db, loanId).loanNo);
    expect(loanById(db, loanId).status).toBe("Overdue");
  });

  it("T9 return on time: → Returned, return date recorded, no late fee", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    toOnLoan(db, "S-060", loanId);
    setToday(db, "2026-11-09");
    const l = recordReturn(as(db, "C-001"), loanId);
    expect([l.status, l.returnDate]).toEqual(["Returned", "2026-11-09"]);
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, loanId)).get()).toBeUndefined();
  });

  it("T10 return overdue: late fee charged and marked paid, → Returned", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    toOnLoan(db, "S-060", loanId);
    setToday(db, "2026-11-10");
    runDailyChecks(as(db, "M-001"));
    setToday(db, "2026-11-12");
    expect(recordReturn(as(db, "C-001"), loanId, { feePaid: true }).status).toBe("Returned");
    const fee = db.select().from(lateFees).where(eq(lateFees.loanId, loanId)).get()!;
    expect([fee.overdueDays, fee.amount, fee.paidAt !== null]).toEqual([3, 3000, true]);
  });

  it("T11 cancel: Approved → Withdrawn with closing reason, borrower notified", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    approveFully(db, loanId);
    const l = cancel(as(db, "M-001"), loanId, "设备临时调去考试使用");
    expect([l.status, l.closingReason]).toEqual(["Withdrawn", "设备临时调去考试使用"]);
    expect(notesFor(db, "S-060", loanId).some((n) => n.message.includes("设备临时调去考试使用"))).toBe(true);
  });
});

describe("each guard can fail", () => {
  it("T1 [not equipmentAvailable]: cannot waitlist when the equipment is free", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    failsWith(() => moveToWaitlist(as(db, "M-001"), loanId), "GUARD_FAILED", "足够");
  });
  it("T3 [allApprovalsGiven]: Manager's approval alone keeps a valuable loan Requested", () => {
    const { loanId } = submit(db, "T-003", { tags: ["CAM-0011"], start: "2026-11-02", due: "2026-11-09", teaching: true });
    expect(approve(as(db, "M-001"), loanId).status).toBe("Requested");
    expect(auditFor(db, loanId).at(-1)!.action).toBe("addApproval");
  });
  it("T3 [equipmentAvailable]: approval refused when the stock is gone (E18)", () => {
    const first = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    const second = submit(db, "S-061", { tags: ["AV-0103"], start: "2026-11-05", due: "2026-11-08" });
    approve(as(db, "M-001"), first.loanId);
    failsWith(() => approve(as(db, "M-001"), second.loanId), "GUARD_FAILED", "设备在借用期间不足");
    expect(loanById(db, second.loanId).status).toBe("Requested");
  });
  it("T3 [noOverdueLoans]: S-014 has JY-0905 overdue (BR-12)", () => {
    setToday(db, "2026-10-08");
    const { loanId } = submit(db, "S-014", { tags: ["TRI-0040"], start: "2026-10-09", due: "2026-10-12" });
    failsWith(() => approve(as(db, "M-001"), loanId), "GUARD_FAILED", "JY-0905");
  });
  it("T4 / T11 [reason given]: blank reasons are refused", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    failsWith(() => reject(as(db, "M-001"), loanId, "   "), "GUARD_FAILED", "原因");
    approveFully(db, loanId);
    failsWith(() => cancel(as(db, "M-001"), loanId, ""), "GUARD_FAILED", "原因");
    expect(loanById(db, loanId).status).toBe("Approved");
  });
  it("T7 [agreementSigned]", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    approveFully(db, loanId);
    failsWith(() => checkOut(as(db, "C-001"), loanId), "GUARD_FAILED", "请先签署借用协议");
  });
  it("T7 [assetTagsVerified]: the transition itself refuses an unverified loan", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    approveFully(db, loanId);
    signAgreement(as(db, "S-060"), loanId);
    failsWith(() => db.transaction((tx) => applyTransition(tx, as(db, "C-001"), loanId, "T7")), "GUARD_FAILED", "资产标签");
  });
  it("T8 [after dueDate]: not on the due date itself", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    toOnLoan(db, "S-060", loanId);
    setToday(db, "2026-11-09");
    failsWith(() => db.transaction((tx) => applyTransition(tx, as(db, "System"), loanId, "T8")), "GUARD_FAILED", "应还日期");
  });
  it("T10: return of an overdue loan is refused until the fee is paid", () => {
    setToday(db, "2026-10-10");
    const jy0905 = loanByNo(db, "JY-0905");
    failsWith(() => recordReturn(as(db, "C-001"), jy0905.id), "GUARD_FAILED", "200 元");
    expect(loanById(db, jy0905.id).status).toBe("Overdue");
  });
});

describe("terminal states accept nothing", () => {
  it("every terminal state has no outgoing transition in the table", () => {
    for (const s of TERMINAL) expect(Object.values(TRANSITIONS).filter((t) => t.from === s)).toEqual([]);
  });
  it("a Returned, a Rejected and a Withdrawn loan refuse further operations", () => {
    const returned = db.select().from(loans).where(eq(loans.status, "Returned")).get()!;
    const rejected = db.select().from(loans).where(eq(loans.status, "Rejected")).get()!;
    const withdrawn = db.select().from(loans).where(eq(loans.status, "Withdrawn")).get()!;
    failsWith(() => recordReturn(as(db, "C-001"), returned.id, { feePaid: true }), "INVALID_STATE", "已归还");
    failsWith(() => approve(as(db, "M-001"), rejected.id), "INVALID_STATE", "已拒绝");
    failsWith(() => cancel(as(db, "M-001"), withdrawn.id, "x"), "INVALID_STATE", "已撤回");
  });
  it("no transition can start from the wrong state", () => {
    for (const t of Object.values(TRANSITIONS)) {
      const other = db.select().from(loans).all().find((l) => l.status !== t.from)!;
      const actor = t.roles[0] === "Borrower" ? "System" : t.roles[0] === "System" ? "System" : { Manager: "M-001", DeptHead: "D-001", Clerk: "C-001" }[t.roles[0] as "Manager"];
      failsWith(() => db.transaction((tx) => applyTransition(tx, as(db, actor), other.id, t.id, { reason: "x", feePaid: true })), "INVALID_STATE");
    }
  });
});

describe("wrong roles are refused on the server (NFUS1 AC1)", () => {
  it("every transition rejects every role not listed for it", () => {
    const codes = { Borrower: "S-060", Clerk: "C-001", Manager: "M-001", DeptHead: "D-001", System: "System" } as const;
    for (const t of Object.values(TRANSITIONS)) {
      const loan = db.select().from(loans).where(eq(loans.status, t.from)).get()!;
      for (const [role, code] of Object.entries(codes)) {
        if ((t.roles as readonly string[]).includes(role)) continue;
        failsWith(() => db.transaction((tx) => applyTransition(tx, as(db, code), loan.id, t.id, { reason: "x", feePaid: true })), "FORBIDDEN");
      }
    }
  });
});

describe("borrower-own transitions (C-03)", () => {
  it("T5/T6 fired directly by another borrower are refused inside the transition itself", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    failsWith(() => db.transaction((tx) => applyTransition(tx, as(db, "S-061"), loanId, "T5")), "NOT_FOUND");
    expect(loanById(db, loanId).status).toBe("Requested");
  });
});

describe("audit trail (NFUS2 AC1)", () => {
  it("one entry per transition with actor, time, before and after", () => {
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    toOnLoan(db, "S-060", loanId);
    setToday(db, "2026-11-10");
    runDailyChecks(as(db, "M-001"));
    setToday(db, "2026-11-12");
    recordReturn(as(db, "C-001"), loanId, { feePaid: true });
    const trail = auditFor(db, loanId).map((a) => [a.action, a.before, a.after, a.at instanceof Date]);
    expect(trail).toEqual([
      ["submit", null, "Requested", true],
      ["T3 approve", "Requested", "Approved", true],
      ["T7 checkOut", "Approved", "OnLoan", true],
      ["T8 expire", "OnLoan", "Overdue", true],
      ["T10 return", "Overdue", "Returned", true],
    ]);
    const actors = auditFor(db, loanId).map((a) => a.actorId === null ? "System" : a.actorId);
    expect(actors[3]).toBe("System");
  });
});

describe("demo controls", () => {
  it("setting changes take effect on the next calculation (NFUS6 AC2)", () => {
    setSetting(db, "lateFeePerDay", "500");
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    toOnLoan(db, "S-060", loanId);
    setToday(db, "2026-11-12");
    recordReturn(as(db, "C-001"), loanId, { feePaid: true });
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, loanId)).get()!.amount).toBe(1500);
  });
});
