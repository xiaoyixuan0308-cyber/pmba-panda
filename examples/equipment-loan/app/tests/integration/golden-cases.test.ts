/** spec/golden-cases.md GC-01 … GC-05, driven through the domain operations (stage 6 repeats them through the UI). */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { approvals, lateFees } from "@/db/schema";
import { runDailyChecks } from "@/domain/loan/daily";
import { approve, checkOut, moveToWaitlist, recordReturn, reject, signAgreement, withdraw, reviewChecks } from "@/domain/loan/service";
import { isFreeFor } from "@/domain/loan/availability";
import { approveFully, as, auditFor, equipmentId, failsWith, freshDb, loanById, loanByNo, notesFor, setToday, submit } from "../helpers/db";

let db: Db;
beforeEach(() => (db = freshDb().db));

describe("golden cases", () => {
  it("GC-01 S-060 borrows AV-0103 Nov 2–9, returns Nov 12, pays 30 yuan", () => {
    setToday(db, "2026-11-01");
    const { loanId } = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });
    expect(reviewChecks(as(db, "M-001"), loanId).approvalRule).toBe("R1");
    expect(approve(as(db, "M-001"), loanId).status).toBe("Approved");
    setToday(db, "2026-11-02");
    signAgreement(as(db, "S-060"), loanId);
    checkOut(as(db, "C-001"), loanId);
    setToday(db, "2026-11-10");
    runDailyChecks(as(db, "M-001"));
    expect(loanById(db, loanId).status).toBe("Overdue");
    expect(notesFor(db, "S-060", loanId).some((n) => n.message.includes("已过应还日期"))).toBe(true);
    setToday(db, "2026-11-12");
    recordReturn(as(db, "C-001"), loanId, { feePaid: true });
    expect(loanById(db, loanId).status).toBe("Returned");
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, loanId)).get()!.amount).toBe(3000);
    expect(auditFor(db, loanId).map((a) => a.action)).toEqual(["submit", "T3 approve", "T7 checkOut", "T8 expire", "T10 return"]);
  });

  it("GC-02 T-003 borrows CAM-0011 off campus for teaching, two approvals, returned early", () => {
    // JY-0902 is already in the ledger as Returned; replay the same journey on next term's dates.
    const jy = loanByNo(db, "JY-0902");
    expect(jy.status).toBe("Returned");
    expect(db.select().from(approvals).where(eq(approvals.loanId, jy.id)).all()).toHaveLength(2);
    setToday(db, "2026-11-01");
    const { loanId } = submit(db, "T-003", { tags: ["CAM-0011"], start: "2026-11-02", due: "2026-11-16", teaching: true, offCampus: true });
    expect(approve(as(db, "M-001"), loanId).status).toBe("Requested");
    expect(approve(as(db, "D-001"), loanId).status).toBe("Approved");
    signAgreement(as(db, "T-003"), loanId);
    checkOut(as(db, "C-001"), loanId);
    setToday(db, "2026-11-15");
    recordReturn(as(db, "C-001"), loanId);
    expect(loanById(db, loanId).status).toBe("Returned");
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, loanId)).get()).toBeUndefined();
  });

  it("GC-03 S-014 is refused while JY-0905 is overdue; JY-0905 returned Oct 10 pays the 200 yuan cap", () => {
    setToday(db, "2026-10-08");
    const { loanId } = submit(db, "S-014", { tags: ["TRI-0040"], start: "2026-10-09", due: "2026-10-12" });
    failsWith(() => approve(as(db, "M-001"), loanId), "GUARD_FAILED", "JY-0905");
    reject(as(db, "M-001"), loanId, "有逾期未还设备");
    expect(loanById(db, loanId).status).toBe("Rejected");
    expect(notesFor(db, "S-014", loanId).at(-1)!.message).toContain("有逾期未还设备");
    setToday(db, "2026-10-10");
    const jy = loanByNo(db, "JY-0905");
    recordReturn(as(db, "C-001"), jy.id, { feePaid: true });
    expect(loanById(db, jy.id).status).toBe("Returned");
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, jy.id)).get()).toMatchObject({ overdueDays: 28, amount: 20000 });
  });

  it("GC-04 S-061 waits for DRN-0002, is released when S-062 returns early, then withdraws", () => {
    setToday(db, "2026-11-01");
    const held = submit(db, "S-062", { tags: ["DRN-0002"], start: "2026-11-02", due: "2026-11-06" });
    approveFully(db, held.loanId); // drone is valuable: Manager then DeptHead (DT-01 R2)
    signAgreement(as(db, "S-062"), held.loanId);
    setToday(db, "2026-11-02");
    checkOut(as(db, "C-001"), held.loanId);
    const { loanId } = submit(db, "S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    moveToWaitlist(as(db, "M-001"), loanId);
    expect(notesFor(db, "S-061", loanId)).toHaveLength(1);
    setToday(db, "2026-11-04");
    recordReturn(as(db, "C-001"), held.loanId);
    expect(loanById(db, loanId).status).toBe("Requested");
    withdraw(as(db, "S-061"), loanId);
    expect(loanById(db, loanId).status).toBe("Withdrawn");
    expect(auditFor(db, loanId).map((a) => a.after)).toEqual(["Requested", "Waitlisted", "Requested", "Withdrawn"]);
    expect(isFreeFor(db, "2026-11-04", equipmentId(db, "DRN-0002"), "2026-11-05", "2026-11-06")).toBe(true);
  });

  it("GC-05 S-022 (past overdue, returned) is approved as normal", () => {
    setToday(db, "2026-10-08");
    const { loanId } = submit(db, "S-022", { tags: ["LGT-0007"], start: "2026-10-09", due: "2026-10-16" });
    expect(reviewChecks(as(db, "M-001"), loanId).overdueLoans).toEqual([]);
    expect(approve(as(db, "M-001"), loanId).status).toBe("Approved");
  });
});
