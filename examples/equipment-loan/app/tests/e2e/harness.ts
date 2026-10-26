/**
 * End-to-end harness: each test file gets a fresh demo database and its own
 * server (`next start`, so run `npm run build` first — `npm run test:e2e` does).
 * Each role gets its own browser context, like separate people at separate desks.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const ROOT = path.resolve(__dirname, "../..");
export const SHOTS = path.resolve(ROOT, "../spec/reviews/6");

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

export const ACCOUNTS = {
  student: "student@demo.local", // S-060
  teacher: "teacher@demo.local", // T-003
  clerk: "clerk@demo.local",
  manager: "manager@demo.local",
  depthead: "depthead@demo.local",
  "S-014": "s-014@demo.local",
  "S-022": "s-022@demo.local",
  "S-061": "s-061@demo.local",
  "S-062": "s-062@demo.local",
} as const;
export type Who = keyof typeof ACCOUNTS;

export class App {
  url = "";
  private server?: ChildProcess;
  private browser?: Browser;
  private sessions = new Map<Who, { ctx: BrowserContext; page: Page }>();
  errors: string[] = [];

  async start() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
    const db = path.join(dir, "app.db");
    execSync("npx tsx scripts/setup.ts", { cwd: ROOT, env: { ...process.env, DB_FILE: db }, stdio: "pipe" });
    const port = await freePort();
    this.url = `http://127.0.0.1:${port}`;
    this.server = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env: { ...process.env, DB_FILE: db, SESSION_SECRET: "e2e-session-secret-0123456789abcdefghijkl", NODE_ENV: "production" },
      stdio: "pipe",
      detached: true,
    });
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`${this.url}/login`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    this.browser = await chromium.launch();
    fs.mkdirSync(SHOTS, { recursive: true });
  }

  async stop() {
    await this.browser?.close();
    if (this.server?.pid) process.kill(-this.server.pid, "SIGTERM");
  }

  /** The page of a signed-in person (logged in on first use). */
  async as(who: Who): Promise<Page> {
    const s = this.sessions.get(who);
    if (s) return s.page;
    const ctx = await this.browser!.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => this.errors.push(`${who}: ${e.message}`));
    await page.goto(`${this.url}/login`);
    await page.fill("#email", ACCOUNTS[who]);
    await page.fill("#password", "demo1234");
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
    this.sessions.set(who, { ctx, page });
    return page;
  }

  async go(who: Who, p: string) {
    const page = await this.as(who);
    await page.goto(`${this.url}${p}`);
    await page.waitForLoadState("networkidle");
    return page;
  }

  /** Demo control on the Manager's settings page: change the simulated date. */
  async setToday(iso: string) {
    const page = await this.go("manager", "/settings");
    const form = page.locator("form", { has: page.locator("#simulatedToday") });
    await form.locator("#simulatedToday").fill(iso);
    await form.getByRole("button", { name: "保存" }).click();
    await form.getByText(`已保存`).waitFor();
  }

  /** Click a button in the main area and wait for the result message (success or error). */
  async press(page: Page, name: string, within?: string) {
    const scope = within ? page.locator("section", { has: page.getByRole("heading", { name: within }) }) : page.locator("main");
    await scope.getByRole("button", { name, exact: true }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
  }

  async status(page: Page) {
    return (await page.locator("main h1 + span").first().innerText()).trim();
  }

  async shot(page: Page, name: string) {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  }

  /** Borrower submits a request through the form; returns the new loan id. */
  async submit(who: Who, r: { tags: string[]; start: string; due: string; purpose: string; offCampus?: boolean; teaching?: boolean }) {
    const page = await this.go(who, "/loans/new");
    await page.fill("#startDate", r.start);
    await page.fill("#dueDate", r.due);
    for (const tag of r.tags) {
      await page.fill("#q", tag);
      await page.locator("button", { hasText: tag }).first().click();
    }
    await page.fill("#purpose", r.purpose);
    await page.check(`input[name=location][value=${r.offCampus ? "off" : "on"}]`);
    if (r.teaching) await page.check("input[name=teaching]");
    await Promise.all([page.waitForURL(/\/loans\/\d+\?created=1/), page.getByRole("button", { name: "提交申请" }).last().click()]);
    return Number(new URL(page.url()).pathname.split("/").pop());
  }

  async loanIdByNo(no: string) {
    const page = await this.go("manager", `/loans?q=${no}`);
    const href = await page.locator("main table a", { hasText: no }).first().getAttribute("href");
    return Number(href!.split("/").pop());
  }

  async text(page: Page) {
    return page.locator("main").innerText();
  }
}
