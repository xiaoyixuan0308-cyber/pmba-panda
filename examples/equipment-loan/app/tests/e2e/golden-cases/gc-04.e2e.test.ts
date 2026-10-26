/** GC-04 设备不足进入等待名单，之后撤回 — spec/golden-cases.md */
import { afterAll, beforeAll, expect, it } from "vitest";
import { App } from "../harness";

const app = new App();
beforeAll(() => app.start());
afterAll(() => app.stop());

it("GC-04 S-061 waits for DRN-0002, goes back to Requested when S-062 returns early, then withdraws", async () => {
  await app.setToday("2026-11-01");
  const held = await app.submit("S-062", { tags: ["DRN-0002"], start: "2026-11-02", due: "2026-11-06", purpose: "航拍作业" });
  await app.press(await app.go("manager", `/loans/${held}`), "同意，交部门负责人审批"); // drone is valuable: DT-01 R2
  await app.press(await app.go("depthead", `/loans/${held}`), "批准");
  const s62 = await app.go("S-062", `/loans/${held}`);
  await s62.getByLabel("我已阅读并同意借用协议").check();
  await app.press(s62, "签署协议");
  await app.setToday("2026-11-02");
  await app.press(await app.go("clerk", `/loans/${held}`), "核对资产标签并借出");
  const heldNo = (await (await app.go("clerk", `/loans/${held}`)).locator("main h1").innerText()).replace("借用单 ", "");

  const id = await app.submit("S-061", { tags: ["DRN-0002"], start: "2026-11-03", due: "2026-11-05", purpose: "航拍练习" });
  const m = await app.go("manager", `/loans/${id}`);
  expect(await app.text(m)).toContain(`DRN-0002 在借用期间被 ${heldNo} 占用`);
  await app.press(m, "转入等待名单");
  expect(await app.status(m)).toBe("等待设备");
  expect(await app.text(await app.go("S-061", "/notifications"))).toContain("已进入等待名单");
  expect(await app.text(await app.go("manager", "/review"))).toContain("DRN-0002");

  await app.setToday("2026-11-04");
  const r = await app.go("clerk", `/loans/${held}`);
  await app.press(r, "确认归还");
  expect(await app.status(r)).toBe("已归还");
  const back = await app.go("manager", `/loans/${id}`);
  expect(await app.status(back)).toBe("已申请");
  expect(await app.text(back)).toContain("设备空出，回到已申请");
  const loanNo = (await back.locator("main h1").innerText()).replace("借用单 ", "");
  expect(await app.text(await app.go("manager", "/notifications"))).toContain(`借用单 ${loanNo} 等待你审批`);

  const w = await app.go("S-061", `/loans/${id}`);
  await app.press(w, "撤回申请");
  expect(await app.status(w)).toBe("已撤回");
  const f = await app.go("manager", `/loans/${id}`);
  const history = await f.locator("section", { has: f.getByRole("heading", { name: "操作历史" }) }).innerText();
  for (const step of ["提交申请", "转入等待名单", "设备空出，回到已申请", "撤回"]) expect(history).toContain(step);
  await app.shot(f, "GC-04-final");
  expect(app.errors).toEqual([]);
});
