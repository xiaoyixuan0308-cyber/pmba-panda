/** S19 / NFUS5 AC3: after a refused submission the borrower fixes one field and resubmits; nothing typed is lost. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { App } from "./harness";

const app = new App();
beforeAll(() => app.start());
afterAll(() => app.stop());

it("NFUS5-AC3 a refused request keeps every field; fixing the due date alone is enough", async () => {
  const page = await app.go("student", "/loans/new");
  await page.fill("#startDate", "2026-10-09");
  await page.fill("#dueDate", "2026-10-30"); // 21 days: beyond DT-02 R1
  await page.fill("#q", "AV-0103");
  await page.locator("button", { hasText: "AV-0103" }).first().click();
  await page.fill("#purpose", "课程作业拍摄");
  await page.check("input[name=location][value=on]");
  await page.getByRole("button", { name: "提交申请" }).last().click();
  await page.locator("main [role=alert]").first().waitFor();
  expect(await page.locator("main [role=alert]").first().innerText()).toContain("最多可以借 14 天");

  // nothing the borrower typed is gone (React resets the form for a moment, then the state puts it back)
  await expect.poll(() => page.inputValue("#purpose")).toBe("课程作业拍摄");
  await expect.poll(() => page.isChecked("input[name=location][value=on]")).toBe(true);
  expect(await page.locator("ul[aria-label='已选择的设备']").innerText()).toContain("AV-0103");

  await page.fill("#dueDate", "2026-10-16");
  await Promise.all([page.waitForURL(/\/loans\/\d+\?created=1/), page.getByRole("button", { name: "提交申请" }).last().click()]);
  expect(await page.locator("main").innerText()).toContain("课程作业拍摄");
  expect(app.errors).toEqual([]);
});
