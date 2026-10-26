/** GC-03 有逾期未还设备的学生申请被拒绝，之后归还时按上限收费 — spec/golden-cases.md (JY-0905) */
import { afterAll, beforeAll, expect, it } from "vitest";
import { App } from "../harness";

const app = new App();
beforeAll(() => app.start());
afterAll(() => app.stop());

it("GC-03 S-014's new request cannot be approved while JY-0905 is overdue; JY-0905 returned Oct 10 pays 200 yuan", async () => {
  const id = await app.submit("S-014", { tags: ["TRI-0040"], start: "2026-10-09", due: "2026-10-12", purpose: "外出采访" });

  const m = await app.go("manager", `/loans/${id}`);
  expect(await app.text(m)).toMatch(/借用人名下有已逾期、尚未归还的借用单：\s*JY-0905/);
  await app.press(m, "批准");
  expect(await m.locator("main [role=alert]").innerText()).toContain("不能批准");
  expect(await app.status(m)).toBe("已申请");
  await app.shot(m, "GC-03-approval-refused");

  await m.fill("#reason", "有逾期未还设备");
  await app.press(m, "拒绝");
  expect(await app.status(m)).toBe("已拒绝");
  expect(await app.text(await app.go("S-014", "/notifications"))).toContain("原因：有逾期未还设备");

  await app.setToday("2026-10-10");
  const jy = await app.loanIdByNo("JY-0905");
  const c = await app.go("clerk", `/loans/${jy}`);
  expect(await app.text(c)).toContain("逾期 28 天，应收逾期费 ¥200.00（已达上限）");
  await app.press(c, "确认归还");
  expect(await c.locator("main [role=alert]").innerText()).toContain("请先收取逾期费 200 元");
  await c.getByLabel(/已当场收取/).check();
  await app.press(c, "确认归还");
  expect(await app.status(c)).toBe("已归还");
  expect(await app.text(c)).toMatch(/逾期 28 天，¥200\.00，已于/);
  await app.shot(c, "GC-03-final");
  expect(app.errors).toEqual([]);
});
