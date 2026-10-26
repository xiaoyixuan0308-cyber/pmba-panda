/** GC-01 学生借投影仪，逾期 3 天归还 — spec/golden-cases.md */
import { afterAll, beforeAll, expect, it } from "vitest";
import { App } from "../harness";

const app = new App();
beforeAll(() => app.start());
afterAll(() => app.stop());

it("GC-01 S-060 borrows AV-0103 Nov 2–9, flagged overdue Nov 10, returns Nov 12 and pays 30 yuan", async () => {
  await app.setToday("2026-11-01");
  const id = await app.submit("student", { tags: ["AV-0103"], start: "2026-11-02", due: "2026-11-09", purpose: "课程作业拍摄" });

  let m = await app.go("manager", `/loans/${id}`);
  expect(await app.text(m)).toContain("DT-01 R1");
  await app.press(m, "批准");
  expect(await app.status(m)).toBe("已批准");

  await app.setToday("2026-11-02");
  const s = await app.go("student", `/loans/${id}`);
  await s.getByLabel("我已阅读并同意借用协议").check();
  await app.press(s, "签署协议");
  const c = await app.go("clerk", `/loans/${id}`);
  await app.press(c, "核对资产标签并借出");
  expect(await app.status(c)).toBe("借出中");

  await app.setToday("2026-11-10");
  m = await app.go("manager", "/review");
  await app.press(m, "运行到期检查（2026-11-10）");
  expect(await app.text(m)).toMatch(/新逾期 \d+ 张/);
  expect(await app.status(await app.go("manager", `/loans/${id}`))).toBe("已逾期");
  expect(await app.text(await app.go("student", "/notifications"))).toContain("已过应还日期 2026-11-09");
  expect(await app.text(await app.go("student", "/me"))).toContain("已逾期，请尽快归还");

  await app.setToday("2026-11-12");
  const r = await app.go("clerk", `/loans/${id}`);
  expect(await app.text(r)).toContain("逾期 3 天，应收逾期费 ¥30.00");
  await r.getByLabel(/已当场收取/).check();
  await app.press(r, "确认归还");
  expect(await app.status(r)).toBe("已归还");
  expect(await app.text(r)).toMatch(/逾期 3 天，¥30\.00，已于/);

  const h = await app.go("manager", `/loans/${id}`);
  const history = await h.locator("section", { has: h.getByRole("heading", { name: "操作历史" }) }).innerText();
  for (const step of ["提交申请", "批准", "签署借用协议", "办理借出", "标为已逾期", "办理归还（逾期）", "收取逾期费"]) expect(history).toContain(step);
  await app.shot(h, "GC-01-final");
  expect(app.errors).toEqual([]);
});
