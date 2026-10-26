/** GC-02 教师借摄像机到校外拍摄教学素材 — spec/golden-cases.md (JY-0902) */
import { afterAll, beforeAll, expect, it } from "vitest";
import { App } from "../harness";

const app = new App();
beforeAll(() => app.start());
afterAll(() => app.stop());

it("GC-02 the ledger record JY-0902 shows both approvals and no fee", async () => {
  const p = await app.go("manager", `/loans/${await app.loanIdByNo("JY-0902")}`);
  const t = await app.text(p);
  expect(await app.status(p)).toBe("已归还");
  expect(t).toContain("2026-09-02 至 2026-09-16（14 天）");
  expect(t).toMatch(/设备管理员[\s\S]*同意[\s\S]*部门负责人[\s\S]*同意/);
  expect(t).not.toContain("逾期费");
  await app.shot(p, "GC-02-ledger-JY-0902");
});

it("GC-02 the same journey through the system: Manager, then DeptHead, check-out, early return", async () => {
  await app.setToday("2026-11-01");
  const id = await app.submit("teacher", { tags: ["CAM-0011"], start: "2026-11-02", due: "2026-11-16", purpose: "校外拍摄教学素材", offCampus: true, teaching: true });

  const m = await app.go("manager", `/loans/${id}`);
  expect(await app.text(m)).toContain("DT-01 R2");
  await app.press(m, "同意，交部门负责人审批");
  expect(await app.status(m)).toBe("已申请");
  expect(await app.text(m)).toContain("等待部门负责人审批");

  const list = await app.go("depthead", "/approvals");
  expect(await app.text(list)).toContain("CAM-0011");
  const d = await app.go("depthead", `/loans/${id}`);
  await app.press(d, "批准");
  expect(await app.status(d)).toBe("已批准");

  const t = await app.go("teacher", `/loans/${id}`);
  await t.getByLabel("我已阅读并同意借用协议").check();
  await app.press(t, "签署协议");
  await app.setToday("2026-11-02");
  const c = await app.go("clerk", `/loans/${id}`);
  await app.press(c, "核对资产标签并借出");

  await app.setToday("2026-11-15");
  const r = await app.go("clerk", `/loans/${id}`);
  expect(await app.text(r)).toContain("未逾期，不收逾期费");
  await app.press(r, "确认归还");
  expect(await app.status(r)).toBe("已归还");

  const f = await app.go("manager", `/loans/${id}`);
  expect((await app.text(f)).match(/同意/g)!.length).toBeGreaterThanOrEqual(2);
  expect(await app.text(f)).not.toContain("逾期费");
  await app.shot(f, "GC-02-final");
  expect(app.errors).toEqual([]);
});
