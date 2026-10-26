/**
 * Acceptance criteria from spec/02-stories.md, one test each, named by AC id.
 * ACs marked [原型演示] or [原型不验证] are checked in stage 5c/6 instead.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { auditEntries, lateFees, loans, people } from "@/db/schema";
import { mockRegistry } from "@/adapters/asset-registry/mock";
import { authenticate } from "@/auth/login";
import { PERMISSIONS } from "@/auth/permissions";
import { updateSetting } from "@/domain/admin";
import { runDailyChecks, APPROVAL_REMINDER_PREFIX, DUE_REMINDER_PREFIX } from "@/domain/loan/daily";
import { getLoanDetail, listLoans, myOverdueLoans, pendingApprovals, waitlist } from "@/domain/loan/queries";
import { approve, cancel, checkOut, moveToWaitlist, quoteReturn, recordReturn, reject, reviewChecks, signAgreement, submitRequest, withdraw, REGISTRY_DOWN_MESSAGE } from "@/domain/loan/service";
import { isFreeFor } from "@/domain/loan/availability";
import { monthlyStats } from "@/domain/stats";
import { maskPhone } from "@/lib/privacy";
import { approveFully, as, equipmentId, failsWith, freshDb, loanById, loanByNo, notesFor, personId, setSetting, setToday, submit, toOnLoan } from "../helpers/db";

let db: Db;
beforeEach(() => {
  db = freshDb().db;
  setToday(db, "2026-11-01");
});
const gc01 = () => submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09" });

describe("FUS1 submit a request", () => {
  it("FUS1-AC1 every required field is checked and explained next to the field", () => {
    const err = failsWith(() => submitRequest(as(db, "S-060"), {}), "VALIDATION") as unknown as { fields: Record<string, string> };
    expect(Object.keys(err.fields).sort()).toEqual(["dueDate", "equipmentIds", "offCampus", "purpose", "startDate"]);
    expect(err.fields.offCampus).toContain("使用地点");
    const blank = failsWith(() => submitRequest(as(db, "S-060"), { equipmentIds: [1], purpose: "  ", offCampus: false, startDate: "2026-11-02", dueDate: "2026-11-03" }), "VALIDATION") as unknown as { fields: Record<string, string> };
    expect(blank.fields).toEqual({ purpose: "请填写用途" });
  });
  it("FUS1-AC2 several items in one request, only from the equipment list", () => {
    const r = submit(db, "S-060", { tags: ["AV-0103", "TRI-0040"], start: "2026-11-02", due: "2026-11-05" });
    expect(getLoanDetail(as(db, "S-060"), r.loanId).items.map((i) => i.assetTag).sort()).toEqual(["AV-0103", "TRI-0040"]);
    failsWith(() => submitRequest(as(db, "S-060"), { equipmentIds: [999999], purpose: "x", offCampus: false, startDate: "2026-11-02", dueDate: "2026-11-03" }), "VALIDATION", "设备列表");
  });
  it("FUS1-AC3 a due date beyond DT-02 is refused with the maximum for this borrower", () => {
    failsWith(() => submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-17" }), "VALIDATION", "最多可以借 14 天");
    failsWith(() => submit(db, "S-060", { tags: ["CAM-0011"], start: "2026-11-02", due: "2026-11-10" }), "VALIDATION", "最多可以借 7 天");
    expect(submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-16" }).status).toBe("Requested"); // exactly 14
  });
  it("FUS1-AC4 the loan number is shown, status Requested, and it appears in the Manager's list", () => {
    const r = gc01();
    expect(r.loanNo).toMatch(/^JY-\d{4}$/);
    expect(r.status).toBe("Requested");
    expect(pendingApprovals(as(db, "M-001")).map((l) => l.id)).toContain(r.loanId);
  });
});

describe("FUS2 withdraw", () => {
  it("FUS2-AC1 Requested → Withdrawn", () => {
    const r = gc01();
    expect(withdraw(as(db, "S-060"), r.loanId).status).toBe("Withdrawn");
  });
  it("FUS2-AC2 Waitlisted → Withdrawn and off the waiting list", () => {
    const held = submit(db, "S-062", { tags: ["DRN-0002"], start: "2026-11-02", due: "2026-11-06" });
    approveFully(db, held.loanId);
    const r = submit(db, "S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    moveToWaitlist(as(db, "M-001"), r.loanId);
    withdraw(as(db, "S-061"), r.loanId);
    expect(waitlist(as(db, "M-001")).map((l) => l.id)).not.toContain(r.loanId);
  });
  it("FUS2-AC3 Approved and later states cannot be withdrawn by the borrower", () => {
    const r = gc01();
    approveFully(db, r.loanId);
    failsWith(() => withdraw(as(db, "S-060"), r.loanId), "INVALID_STATE", "联系设备管理员");
  });
  it("FUS2-AC4 after withdrawal the equipment can be used by others", () => {
    const r = gc01();
    approveFully(db, r.loanId);
    expect(isFreeFor(db, "2026-11-01", equipmentId(db, "AV-0103"), "2026-11-03", "2026-11-04")).toBe(false);
    cancel(as(db, "M-001"), r.loanId, "借用人改期");
    expect(isFreeFor(db, "2026-11-01", equipmentId(db, "AV-0103"), "2026-11-03", "2026-11-04")).toBe(true);
    const other = submit(db, "S-061", { tags: ["AV-0103"], start: "2026-11-03", due: "2026-11-04" });
    expect(approve(as(db, "M-001"), other.loanId).status).toBe("Approved");
  });
});

describe("FUS3 Manager's review", () => {
  it("FUS3-AC1 both checks are reported together", () => {
    setToday(db, "2026-10-08");
    const r = submit(db, "S-014", { tags: ["TRI-0040"], start: "2026-10-09", due: "2026-10-12" });
    const c = reviewChecks(as(db, "M-001"), r.loanId);
    expect(c.overdueLoans.map((o) => o.loanNo)).toEqual(["JY-0905"]);
    expect(c.shortItems).toEqual([]);
  });
  it("FUS3-AC2 short equipment → Waitlisted, borrower notified", () => {
    const held = submit(db, "S-062", { tags: ["DRN-0002"], start: "2026-11-02", due: "2026-11-06" });
    approveFully(db, held.loanId);
    const r = submit(db, "S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    expect(reviewChecks(as(db, "M-001"), r.loanId).shortItems.map((s) => s.assetTag)).toEqual(["DRN-0002"]);
    expect(moveToWaitlist(as(db, "M-001"), r.loanId).status).toBe("Waitlisted");
    expect(notesFor(db, "S-061", r.loanId)).toHaveLength(1);
  });
  it("FUS3-AC3 approval refused while the borrower has an overdue loan, with the reason", () => {
    setToday(db, "2026-10-08");
    const r = submit(db, "S-014", { tags: ["TRI-0040"], start: "2026-10-09", due: "2026-10-12" });
    failsWith(() => approve(as(db, "M-001"), r.loanId), "GUARD_FAILED", "已逾期");
  });
  it("FUS3-AC4 rejection needs a reason; the borrower is told the reason", () => {
    const r = gc01();
    failsWith(() => reject(as(db, "M-001"), r.loanId, ""), "GUARD_FAILED");
    reject(as(db, "M-001"), r.loanId, "有逾期未还设备");
    expect(loanById(db, r.loanId).status).toBe("Rejected");
    expect(notesFor(db, "S-060", r.loanId).at(-1)!.message).toContain("有逾期未还设备");
  });
  it("FUS3-AC5 DT-01 R1: the Manager's approval alone approves it, borrower notified", () => {
    const r = gc01();
    expect(approve(as(db, "M-001"), r.loanId).status).toBe("Approved");
    expect(notesFor(db, "S-060", r.loanId).some((n) => n.message.includes("已批准"))).toBe(true);
  });
  it("FUS3-AC6 past overdue loans that were returned do not block (S-022, GC-05)", () => {
    setToday(db, "2026-10-08");
    const r = submit(db, "S-022", { tags: ["LGT-0007"], start: "2026-10-09", due: "2026-10-16" });
    expect(reviewChecks(as(db, "M-001"), r.loanId).overdueLoans).toEqual([]);
    expect(approve(as(db, "M-001"), r.loanId).status).toBe("Approved");
  });
});

describe("FUS4 DeptHead approval", () => {
  const camera = () => submit(db, "T-003", { tags: ["CAM-0011"], start: "2026-11-02", due: "2026-11-16", teaching: true, offCampus: true });
  it("FUS4-AC1 valuable or off-campus: still Requested after the Manager, now in the DeptHead's list", () => {
    const r = camera();
    expect(approve(as(db, "M-001"), r.loanId).status).toBe("Requested");
    expect(pendingApprovals(as(db, "D-001")).map((l) => l.id)).toContain(r.loanId);
    const offCampus = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-05", offCampus: true });
    expect(approve(as(db, "M-001"), offCampus.loanId).status).toBe("Requested"); // DT-01 R3
  });
  it("FUS4-AC2 after the Manager, the DeptHead's approval approves it", () => {
    const r = camera();
    approve(as(db, "M-001"), r.loanId);
    expect(approve(as(db, "D-001"), r.loanId).status).toBe("Approved");
    expect(notesFor(db, "T-003", r.loanId).some((n) => n.message.includes("已批准"))).toBe(true);
  });
  it("FUS4-AC3 the DeptHead's rejection needs a reason and rejects the loan", () => {
    const r = camera();
    approve(as(db, "M-001"), r.loanId);
    failsWith(() => reject(as(db, "D-001"), r.loanId, ""), "GUARD_FAILED");
    expect(reject(as(db, "D-001"), r.loanId, "校外拍摄需另行报备").status).toBe("Rejected");
  });
  it("FUS4-AC4 the DeptHead's list only holds loans the Manager has approved, and cannot jump the queue", () => {
    const r = camera();
    expect(pendingApprovals(as(db, "D-001")).map((l) => l.id)).not.toContain(r.loanId);
    failsWith(() => approve(as(db, "D-001"), r.loanId), "GUARD_FAILED", "先由设备管理员");
    for (const l of pendingApprovals(as(db, "D-001"))) {
      expect(db.select().from(loans).where(eq(loans.id, l.id)).get()!.status).toBe("Requested");
    }
  });
  it("FUS4-AC5 exactly 5000 yuan is not valuable: no DeptHead needed", () => {
    setToday(db, "2027-01-03");
    const r = submit(db, "S-060", { tags: ["GIM-0001"], start: "2027-01-04", due: "2027-01-11" });
    expect(reviewChecks(as(db, "M-001"), r.loanId).approvers).toEqual(["Manager"]);
    expect(approve(as(db, "M-001"), r.loanId).status).toBe("Approved");
    failsWith(() => approve(as(db, "D-001"), submit(db, "S-061", { tags: ["GIM-0001"], start: "2027-02-01", due: "2027-02-03" }).loanId), "FORBIDDEN", "不需要部门负责人");
  });
});

describe("FUS5 check-out", () => {
  const approved = () => {
    const r = gc01();
    approveFully(db, r.loanId);
    return r.loanId;
  };
  it("FUS5-AC1 without the agreement: 请先签署借用协议", () => {
    failsWith(() => checkOut(as(db, "C-001"), approved()), "GUARD_FAILED", "请先签署借用协议");
  });
  it("FUS5-AC2 one failing tag stops the whole loan and names the tag", () => {
    const r = submit(db, "T-007", { tags: ["CAM-0013", "TRI-0040"], start: "2026-11-02", due: "2026-11-05" });
    approveFully(db, r.loanId);
    signAgreement(as(db, "T-007"), r.loanId);
    failsWith(() => checkOut(as(db, "C-001"), r.loanId), "GUARD_FAILED", "CAM-0013");
    expect(loanById(db, r.loanId).status).toBe("Approved");
  });
  it("FUS5-AC3 registry down: the agreed message, loan stays Approved", () => {
    const id = approved();
    signAgreement(as(db, "S-060"), id);
    setSetting(db, "registryAvailable", "false");
    failsWith(() => checkOut(as(db, "C-001", { registry: mockRegistry(db) }), id), "REGISTRY_UNAVAILABLE", REGISTRY_DOWN_MESSAGE);
    expect(loanById(db, id).status).toBe("Approved");
  });
  it("FUS5-AC4 signed and verified → OnLoan, date and clerk recorded", () => {
    const id = approved();
    signAgreement(as(db, "S-060"), id);
    const l = checkOut(as(db, "C-001"), id);
    expect(l.status).toBe("OnLoan");
    const a = db.select().from(auditEntries).where(eq(auditEntries.objectId, id)).all().find((x) => x.action === "T7 checkOut")!;
    expect(a.actorId).toBe(personId(db, "C-001"));
    expect(l.checkOutDate).not.toBeNull();
  });
});

describe("FUS6 overdue flagged the day after", () => {
  const onLoan = () => {
    const r = gc01();
    toOnLoan(db, "S-060", r.loanId);
    return r.loanId;
  };
  it("FUS6-AC1 the check after the due date flags it and notifies borrower and Manager", () => {
    const id = onLoan();
    setToday(db, "2026-11-10");
    runDailyChecks(as(db, "M-001"));
    expect(loanById(db, id).status).toBe("Overdue");
    expect(notesFor(db, "S-060", id).some((n) => n.message.startsWith("【逾期提醒】"))).toBe(true);
    expect(notesFor(db, "M-001", id).some((n) => n.message.startsWith("【逾期提醒】"))).toBe(true);
  });
  it("FUS6-AC2 not on the due date itself", () => {
    const id = onLoan();
    setToday(db, "2026-11-09");
    runDailyChecks(as(db, "M-001"));
    expect(loanById(db, id).status).toBe("OnLoan");
  });
  it("FUS6-AC3 the Manager can run the check by hand; other staff cannot", () => {
    expect(() => runDailyChecks(as(db, "M-001"))).not.toThrow();
    failsWith(() => runDailyChecks(as(db, "C-001")), "FORBIDDEN");
    failsWith(() => runDailyChecks(as(db, "S-060")), "FORBIDDEN");
  });
  it("FUS6-AC4 the borrower's own overdue loans are available for the home page", () => {
    setToday(db, "2026-10-08");
    expect(myOverdueLoans(as(db, "S-014")).map((l) => l.loanNo)).toEqual(["JY-0905"]);
    expect(myOverdueLoans(as(db, "S-022"))).toEqual([]);
  });
});

describe("FUS7 late fee at return", () => {
  it("FUS7-AC1 OnLoan return → Returned without a fee", () => {
    const r = gc01();
    toOnLoan(db, "S-060", r.loanId);
    setToday(db, "2026-11-08");
    expect(quoteReturn(as(db, "C-001"), r.loanId).amount).toBe(0);
    expect(recordReturn(as(db, "C-001"), r.loanId).status).toBe("Returned");
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, r.loanId)).get()).toBeUndefined();
  });
  it("FUS7-AC2 Overdue return: 10 yuan per day, recorded as paid, → Returned", () => {
    const r = gc01();
    toOnLoan(db, "S-060", r.loanId);
    setToday(db, "2026-11-10");
    runDailyChecks(as(db, "M-001"));
    setToday(db, "2026-11-12");
    expect(quoteReturn(as(db, "C-001"), r.loanId)).toMatchObject({ overdueDays: 3, amount: 3000 });
    recordReturn(as(db, "C-001"), r.loanId, { feePaid: true });
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, r.loanId)).get()).toMatchObject({ overdueDays: 3, amount: 3000 });
  });
  it("FUS7-AC3 capped at 200 yuan: JY-0905 returned Oct 10 → 28 days, 200 yuan", () => {
    setToday(db, "2026-10-10");
    const id = loanByNo(db, "JY-0905").id;
    expect(quoteReturn(as(db, "C-001"), id)).toMatchObject({ overdueDays: 28, amount: 20000, capped: true });
    recordReturn(as(db, "C-001"), id, { feePaid: true });
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, id)).get()).toMatchObject({ overdueDays: 28, amount: 20000 });
  });
  it("FUS7-AC4 there is no operation to waive or change a fee", () => {
    expect(Object.keys(PERMISSIONS).filter((k) => /fee|waive|减免/i.test(k))).toEqual([]);
  });
  it("FUS7-AC5 both Clerk and Manager can record a return", () => {
    const a = gc01();
    toOnLoan(db, "S-060", a.loanId);
    const b = submit(db, "S-061", { tags: ["TRI-0040"], start: "2026-11-02", due: "2026-11-05" });
    toOnLoan(db, "S-061", b.loanId);
    setToday(db, "2026-11-04");
    expect(recordReturn(as(db, "C-001"), a.loanId).status).toBe("Returned");
    expect(recordReturn(as(db, "M-001"), b.loanId).status).toBe("Returned");
  });
  it("a loan past due but not yet flagged still pays the fee (BR-10)", () => {
    const r = gc01();
    toOnLoan(db, "S-060", r.loanId);
    setToday(db, "2026-11-11"); // daily check not run
    failsWith(() => recordReturn(as(db, "C-001"), r.loanId), "GUARD_FAILED", "20 元");
    recordReturn(as(db, "C-001"), r.loanId, { feePaid: true });
    expect(db.select().from(lateFees).where(eq(lateFees.loanId, r.loanId)).get()!.amount).toBe(2000);
  });
});

describe("FUS8 waiting list", () => {
  const setup = () => {
    const held = submit(db, "S-062", { tags: ["DRN-0002"], start: "2026-11-02", due: "2026-11-06" });
    toOnLoan(db, "S-062", held.loanId);
    const w = submit(db, "S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    moveToWaitlist(as(db, "M-001"), w.loanId);
    return { held: held.loanId, waiting: w.loanId };
  };
  it("FUS8-AC1 when the equipment comes back the Manager is notified", () => {
    const { held, waiting } = setup();
    setToday(db, "2026-11-04");
    const before = notesFor(db, "M-001", waiting).length;
    recordReturn(as(db, "C-001"), held);
    expect(notesFor(db, "M-001", waiting).length).toBe(before + 1);
  });
  it("FUS8-AC2 the waiting loan goes back to Requested and is checked again", () => {
    const { held, waiting } = setup();
    setToday(db, "2026-11-04");
    recordReturn(as(db, "C-001"), held);
    expect(loanById(db, waiting).status).toBe("Requested");
    expect(reviewChecks(as(db, "M-001"), waiting).shortItems).toEqual([]);
  });
  it("FUS8-AC3 the waiting list is in submission order", () => {
    const ts = waitlist(as(db, "M-001")).map((l) => l.submittedAt.getTime());
    expect(ts.length).toBeGreaterThanOrEqual(3);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
  it("one freed item goes to the earliest waiting loan only", () => {
    const { held, waiting } = setup();
    const later = submit(db, "S-060", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05" });
    moveToWaitlist(as(db, "M-001"), later.loanId);
    setToday(db, "2026-11-04");
    recordReturn(as(db, "C-001"), held);
    expect([loanById(db, waiting).status, loanById(db, later.loanId).status]).toEqual(["Requested", "Waitlisted"]);
  });
});

describe("FUS9 cancel an approved loan", () => {
  it("FUS9-AC1 Approved → Withdrawn with a reason", () => {
    const r = gc01();
    approveFully(db, r.loanId);
    expect(cancel(as(db, "M-001"), r.loanId, "设备送修").status).toBe("Withdrawn");
  });
  it("FUS9-AC2 OnLoan and later cannot be cancelled", () => {
    const r = gc01();
    toOnLoan(db, "S-060", r.loanId);
    failsWith(() => cancel(as(db, "M-001"), r.loanId, "设备送修"), "INVALID_STATE", "借出中");
  });
  it("FUS9-AC3 the borrower is told the reason", () => {
    const r = gc01();
    approveFully(db, r.loanId);
    cancel(as(db, "M-001"), r.loanId, "设备送修");
    expect(notesFor(db, "S-060", r.loanId).at(-1)!.message).toContain("设备送修");
  });
});

describe("FUS10 approval reminders", () => {
  const remindersTo = (code: string, loanId: number) => notesFor(db, code, loanId).filter((n) => n.message.startsWith(APPROVAL_REMINDER_PREFIX));
  it("FUS10-AC1 reminded once 2 working days have passed, not before, and not twice a day", () => {
    setToday(db, "2026-11-02"); // Monday
    const r = gc01();
    setToday(db, "2026-11-03");
    runDailyChecks(as(db, "M-001"));
    expect(remindersTo("M-001", r.loanId)).toHaveLength(0);
    setToday(db, "2026-11-04");
    runDailyChecks(as(db, "M-001"));
    runDailyChecks(as(db, "M-001"));
    expect(remindersTo("M-001", r.loanId)).toHaveLength(1);
  });
  it("FUS10-AC2 weekends do not count", () => {
    setToday(db, "2026-11-06"); // Friday
    const r = submit(db, "S-060", { tags: ["AV-0103"], start: "2026-11-09", due: "2026-11-12" });
    setToday(db, "2026-11-09"); // Monday = 1 working day
    runDailyChecks(as(db, "M-001"));
    expect(remindersTo("M-001", r.loanId)).toHaveLength(0);
    setToday(db, "2026-11-10");
    runDailyChecks(as(db, "M-001"));
    expect(remindersTo("M-001", r.loanId)).toHaveLength(1);
  });
  it("FUS10-AC3 only the approver who still has to decide is reminded", () => {
    setToday(db, "2026-11-02");
    const r = submit(db, "T-003", { tags: ["CAM-0011"], start: "2026-11-05", due: "2026-11-12", teaching: true });
    const short = gc01();
    approve(as(db, "M-001"), r.loanId);
    setToday(db, "2026-11-04");
    runDailyChecks(as(db, "M-001"));
    expect(remindersTo("M-001", r.loanId)).toHaveLength(0);
    expect(remindersTo("D-001", r.loanId)).toHaveLength(1);
    expect(remindersTo("D-001", short.loanId)).toHaveLength(0); // R1: DeptHead not needed
  });
  it("the reminder setting takes effect (NFUS6 AC2)", () => {
    setToday(db, "2026-11-02");
    const r = gc01();
    updateSetting(as(db, "M-001"), "reminderWorkingDays", "1");
    setToday(db, "2026-11-03");
    runDailyChecks(as(db, "M-001"));
    expect(remindersTo("M-001", r.loanId)).toHaveLength(1);
  });
  it("rules note: OnLoan borrowers are reminded the day before the due date, once", () => {
    const r = gc01();
    toOnLoan(db, "S-060", r.loanId);
    setToday(db, "2026-11-08");
    runDailyChecks(as(db, "M-001"));
    runDailyChecks(as(db, "M-001"));
    expect(notesFor(db, "S-060", r.loanId).filter((n) => n.message.startsWith(DUE_REMINDER_PREFIX))).toHaveLength(1);
  });
});

describe("FUS11 monthly statistics", () => {
  it("FUS11-AC1 loans per month by status add up to the month's total", () => {
    const s = monthlyStats(as(db, "D-001"), "2026-09");
    expect(s.submitted).toBeGreaterThan(100);
    expect(Object.values(s.byStatus).reduce((a, b) => a + b, 0)).toBe(s.submitted);
  });
  it("FUS11-AC2 the 10 most checked-out items, highest first", () => {
    const s = monthlyStats(as(db, "D-001"), "2026-09");
    expect(s.top10).toHaveLength(10);
    const n = s.top10.map((t) => t.checkOuts);
    expect([...n].sort((a, b) => b - a)).toEqual(n);
  });
  it("FUS11-AC3 a return on the due date is not overdue; a later one is (BR-07)", () => {
    setToday(db, "2027-01-03");
    const onTime = submit(db, "S-060", { tags: ["GIM-0001"], start: "2027-01-04", due: "2027-01-11" });
    const late = submit(db, "S-061", { tags: ["TRI-0040"], start: "2027-01-04", due: "2027-01-08" });
    toOnLoan(db, "S-060", onTime.loanId);
    toOnLoan(db, "S-061", late.loanId);
    setToday(db, "2027-01-11");
    recordReturn(as(db, "C-001"), onTime.loanId);
    recordReturn(as(db, "C-001"), late.loanId, { feePaid: true });
    setToday(db, "2027-01-20");
    expect(monthlyStats(as(db, "D-001"), "2027-01")).toMatchObject({ checkedOut: 2, becameOverdue: 1, overdueRate: 0.5 });
  });
  it("FUS11-AC3 overdue rate = loans that became overdue ÷ loans checked out in the month", () => {
    const s = monthlyStats(as(db, "D-001"), "2026-09");
    expect(s.overdueRate).toBeCloseTo(s.becameOverdue / s.checkedOut, 10);
    expect(s.becameOverdue).toBeGreaterThan(0);
    failsWith(() => monthlyStats(as(db, "M-001"), "2026-09"), "FORBIDDEN");
  });
});

describe("NFUS1 access control", () => {
  it("NFUS1-AC1 operations outside the CRUD matrix are refused on the server", () => {
    const r = gc01();
    failsWith(() => approve(as(db, "C-001"), r.loanId), "FORBIDDEN");
    failsWith(() => approve(as(db, "S-060"), r.loanId), "FORBIDDEN");
    approveFully(db, r.loanId);
    failsWith(() => cancel(as(db, "D-001"), r.loanId, "x"), "FORBIDDEN");
    signAgreement(as(db, "S-060"), r.loanId);
    failsWith(() => checkOut(as(db, "M-001"), r.loanId), "FORBIDDEN");
    failsWith(() => checkOut(as(db, "S-060"), r.loanId), "FORBIDDEN");
    failsWith(() => updateSetting(as(db, "C-001"), "lateFeeCap", "1"), "FORBIDDEN");
    failsWith(() => submit(db, "M-001", { tags: ["TRI-0040"], start: "2026-11-02", due: "2026-11-03" }), "FORBIDDEN");
  });
  it("NFUS1-AC2 borrowers see only their own loans", () => {
    const mine = listLoans(as(db, "S-014"), { pageSize: 100 });
    const id = personId(db, "S-014");
    expect(mine.rows.length).toBeGreaterThan(0);
    for (const row of mine.rows) expect(loanById(db, row.id).borrowerId).toBe(id);
    const other = gc01();
    failsWith(() => getLoanDetail(as(db, "S-014"), other.loanId), "NOT_FOUND");
    failsWith(() => withdraw(as(db, "S-014"), other.loanId), "NOT_FOUND");
    failsWith(() => signAgreement(as(db, "S-014"), other.loanId), "NOT_FOUND");
  });
  it("NFUS1-AC3 five failed logins lock the account for 15 minutes", () => {
    const t0 = new Date("2026-11-01T02:00:00Z");
    for (let i = 1; i <= 4; i++) failsWith(() => authenticate(db, "student@demo.local", "wrong", t0), "BAD_CREDENTIALS");
    failsWith(() => authenticate(db, "student@demo.local", "wrong", t0), "ACCOUNT_LOCKED", "15 分钟");
    failsWith(() => authenticate(db, "student@demo.local", "demo1234", new Date(t0.getTime() + 14 * 60000)), "ACCOUNT_LOCKED");
    expect(authenticate(db, "student@demo.local", "demo1234", new Date(t0.getTime() + 15 * 60000 + 1)).role).toBe("Borrower");
  });
});

describe("NFUS2 audit", () => {
  it("NFUS2-AC1 approval, cancel, check-out, return, overdue and fee are all recorded", () => {
    const r = gc01();
    toOnLoan(db, "S-060", r.loanId);
    setToday(db, "2026-11-10");
    runDailyChecks(as(db, "M-001"));
    setToday(db, "2026-11-12");
    recordReturn(as(db, "C-001"), r.loanId, { feePaid: true });
    const c = submit(db, "S-061", { tags: ["TRI-0040"], start: "2026-11-13", due: "2026-11-14" });
    approveFully(db, c.loanId);
    cancel(as(db, "M-001"), c.loanId, "设备送修");
    const actions = db.select().from(auditEntries).all().filter((a) => a.at >= new Date("2026-10-31T00:00:00Z")).map((a) => a.action);
    for (const a of ["T3 approve", "T11 cancel", "T7 checkOut", "T10 return", "T8 expire", "chargeLateFee"]) expect(actions).toContain(a);
    const detail = getLoanDetail(as(db, "M-001"), r.loanId);
    expect(detail.history!.map((h) => h.action)).toEqual(["submit", "T3 approve", "signAgreement", "T7 checkOut", "T8 expire", "T10 return", "chargeLateFee"]);
  });
  it("NFUS2-AC2 audit entries cannot be changed or deleted, even directly in the database", () => {
    const { sqlite } = freshDb();
    expect(() => sqlite.prepare("update audit_entries set action = 'x' where id = 1").run()).toThrow(/append-only/);
    expect(() => sqlite.prepare("delete from audit_entries where id = 1").run()).toThrow(/append-only/);
  });
});

describe("NFUS3 privacy", () => {
  it("NFUS3-AC1 DeptHead sees a masked phone, Clerk and Manager the full number", () => {
    const r = gc01();
    const phone = db.select().from(people).where(eq(people.id, personId(db, "S-060"))).get()!.phone;
    expect(getLoanDetail(as(db, "D-001"), r.loanId).borrower.phone).toBe(maskPhone(phone));
    expect(maskPhone(phone)).toMatch(/^\d{3}\*{4}\d{4}$/);
    expect(getLoanDetail(as(db, "C-001"), r.loanId).borrower.phone).toBe(phone);
    expect(getLoanDetail(as(db, "M-001"), r.loanId).borrower.phone).toBe(phone);
    expect(getLoanDetail(as(db, "S-060"), r.loanId).borrower.phone).toBe(phone);
  });
});

describe("NFUS4 performance on ~5000 loans", () => {
  it("NFUS4-AC1 list and search under 2 seconds", () => {
    expect(db.select().from(loans).all().length).toBeGreaterThan(4500);
    for (const q of [undefined, "JY-4", "S-1", "CAM-00"]) {
      const t = performance.now();
      const r = listLoans(as(db, "C-001"), { q });
      expect(performance.now() - t).toBeLessThan(2000);
      expect(r.total).toBeGreaterThan(0);
    }
  });
  it("NFUS4-AC2 saving a check-out and a return takes under 1 second", () => {
    const r = gc01();
    approveFully(db, r.loanId);
    signAgreement(as(db, "S-060"), r.loanId);
    let t = performance.now();
    checkOut(as(db, "C-001"), r.loanId);
    expect(performance.now() - t).toBeLessThan(1000);
    t = performance.now();
    recordReturn(as(db, "C-001"), r.loanId);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe("NFUS5 / NFUS6", () => {
  it("NFUS5-AC3 failed submissions explain each field (see FUS1-AC1); required fields are listed", () => {
    const err = failsWith(() => submitRequest(as(db, "S-060"), { equipmentIds: [] }), "VALIDATION") as unknown as { fields: Record<string, string> };
    expect(err.fields.equipmentIds).toBe("请至少选择 1 件设备");
  });
  it("NFUS6-AC1 loans cannot be deleted (no operation, and refused by the database)", () => {
    expect(Object.keys(PERMISSIONS).filter((k) => /delete/i.test(k))).toEqual([]);
    const { sqlite } = freshDb();
    expect(() => sqlite.prepare("delete from loans where id = 1").run()).toThrow(/never deleted/);
  });
  it("NFUS6-AC2 the Manager changes fee per day, cap and reminder days; invalid values are refused", () => {
    const m = as(db, "M-001");
    updateSetting(m, "lateFeeCap", "15000");
    failsWith(() => updateSetting(m, "lateFeePerDay", "-1"), "VALIDATION");
    failsWith(() => updateSetting(m, "reminderWorkingDays", "abc"), "VALIDATION");
    setToday(db, "2026-10-10");
    expect(quoteReturn(as(db, "C-001"), loanByNo(db, "JY-0905").id).amount).toBe(15000);
  });
});
