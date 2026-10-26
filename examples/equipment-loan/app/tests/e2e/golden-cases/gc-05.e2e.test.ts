/** GC-05 有过逾期记录但已归还的学生，申请照常审批 — spec/golden-cases.md (JY-0903, X3) */
import { afterAll, beforeAll, expect, it } from "vitest";
import { App } from "../harness";

const app = new App();
beforeAll(() => app.start());
afterAll(() => app.stop());

it("GC-05 S-022 (JY-0903 returned late and paid) is approved as normal", async () => {
  const id = await app.submit("S-022", { tags: ["LGT-0007"], start: "2026-10-09", due: "2026-10-16", purpose: "人像布光练习" });
  const m = await app.go("manager", `/loans/${id}`);
  expect(await app.text(m)).toContain("没有逾期未还的借用单");
  expect(await app.text(m)).toContain("DT-01 R1");
  await app.press(m, "批准");
  expect(await app.status(m)).toBe("已批准");
  await app.shot(m, "GC-05-final");

  const old = await app.go("manager", `/loans/${await app.loanIdByNo("JY-0903")}`);
  expect(await app.text(old)).toMatch(/逾期 5 天，¥50\.00/);
  expect(app.errors).toEqual([]);
});
