/** Rehearses spec/06-demo-script.md step by step, so the live demo cannot surprise anyone. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { App } from "./harness";

const app = new App();
beforeAll(() => app.start());
afterAll(() => app.stop());

it("demo script 06-demo-script.md runs as written", async () => {
  // 演示前
  const s014 = await app.submit("S-014", { tags: ["TRI-0040"], start: "2026-10-09", due: "2026-10-12", purpose: "外出采访" });
  const s022 = await app.submit("S-022", { tags: ["LGT-0007"], start: "2026-10-09", due: "2026-10-16", purpose: "人像布光练习" });
  const cam = await app.submit("teacher", { tags: ["CAM-0011"], start: "2026-10-09", due: "2026-10-23", purpose: "校外拍摄教学素材", offCampus: true, teaching: true });

  // 1. empty submit explains each field; two items in one request
  const form = await app.go("student", "/loans/new");
  await form.getByRole("button", { name: "提交申请" }).last().click();
  await form.waitForTimeout(800);
  expect((await form.locator("p.text-red-700").allInnerTexts()).length).toBe(5);
  const mine = await app.submit("student", { tags: ["AV-0103", "TRI-0001"], start: "2026-10-08", due: "2026-10-15", purpose: "课程作业拍摄" });
  expect(await app.text(await app.go("student", `/loans/${mine}`))).toContain("设备（2 件）");

  // 2. S-014 refused (JY-0905), S-022 approved
  let m = await app.go("manager", "/review");
  expect(await app.text(m)).toContain("TRI-0040");
  m = await app.go("manager", `/loans/${s014}`);
  expect(await app.text(m)).toContain("JY-0905");
  await app.press(m, "批准");
  expect(await m.locator("main [role=alert]").innerText()).toContain("不能批准");
  await m.fill("#reason", "有逾期未还设备");
  await app.press(m, "拒绝");
  expect(await app.status(m)).toBe("已拒绝");
  m = await app.go("manager", `/loans/${s022}`);
  expect(await app.text(m)).toContain("没有逾期未还的借用单");
  await app.press(m, "批准");
  expect(await app.status(m)).toBe("已批准");

  // 3. Manager, then DeptHead
  m = await app.go("manager", `/loans/${cam}`);
  await app.press(m, "同意，交部门负责人审批");
  expect(await app.text(m)).toContain("等待部门负责人审批");
  expect(await app.text(await app.go("depthead", "/approvals"))).toContain("CAM-0011");
  const d = await app.go("depthead", `/loans/${cam}`);
  await app.press(d, "批准");
  expect(await app.status(d)).toBe("已批准");

  // 4. counter: unsigned shown, registry down, then signed and checked out
  await app.press(await app.go("manager", `/loans/${mine}`), "批准");
  let c = await app.go("clerk", "/counter");
  expect(await app.text(c)).toContain("TRI-0001");
  c = await app.go("clerk", `/loans/${mine}`);
  expect(await app.text(c)).toContain("借用协议未签署");
  const s = await app.go("student", `/loans/${mine}`);
  await s.getByLabel("我已阅读并同意借用协议").check();
  await app.press(s, "签署协议");
  const settings = await app.go("manager", "/settings");
  const reg = settings.locator("form", { has: settings.locator("#registryAvailable") });
  await reg.locator("#registryAvailable").fill("false");
  await reg.getByRole("button", { name: "保存" }).click();
  await reg.getByText("已保存").waitFor();
  c = await app.go("clerk", `/loans/${mine}`);
  await app.press(c, "核对资产标签并借出");
  expect(await c.locator("main [role=alert]").innerText()).toContain("暂时无法核对资产标签");
  expect(await app.status(c)).toBe("已批准");
  const s2 = await app.go("manager", "/settings");
  const reg2 = s2.locator("form", { has: s2.locator("#registryAvailable") });
  await reg2.locator("#registryAvailable").fill("true");
  await reg2.getByRole("button", { name: "保存" }).click();
  await reg2.getByText("已保存").waitFor();
  c = await app.go("clerk", `/loans/${mine}`);
  await app.press(c, "核对资产标签并借出");
  expect(await app.status(c)).toBe("借出中");

  // 5. overdue the day after
  expect(await app.text(await app.go("manager", "/review"))).toContain("JY-0905");
  await app.setToday("2026-10-10");
  m = await app.go("manager", "/review");
  await app.press(m, "运行到期检查（2026-10-10）");
  const result = await m.locator("main [role=status]").first().innerText();
  expect(result).toMatch(/新逾期 [1-9]\d* 张（JY-/);

  // 6. JY-0905: 28 days, capped at 200
  c = await app.go("clerk", "/counter");
  expect(await app.text(c)).toContain("JY-0905");
  c = await app.go("clerk", `/loans/${await app.loanIdByNo("JY-0905")}`);
  expect(await app.text(c)).toContain("逾期 28 天，应收逾期费 ¥200.00（已达上限）");
  await c.getByLabel(/已当场收取/).check();
  await app.press(c, "确认归还");
  expect(await app.status(c)).toBe("已归还");

  // 7. waiting list, 8. statistics
  expect(await app.text(await app.go("manager", "/review"))).toMatch(/等待名单（按提交时间，[1-9]/);
  const st = await app.go("depthead", "/stats?month=2026-09");
  expect(await app.text(st)).toMatch(/逾期率[\s\S]*%/);
  expect(await app.text(st)).toContain("借出次数最多的 10 件设备");
  expect(app.errors).toEqual([]);
});
