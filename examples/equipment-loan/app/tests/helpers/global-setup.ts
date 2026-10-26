/** Build the demo database once; every test file works on its own copy. */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

export default function setup(project: TestProject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loan-template-"));
  const file = path.join(dir, "template.db");
  execSync("npx tsx scripts/setup.ts", { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, DB_FILE: file }, stdio: "pipe" });
  project.provide("templateDb", file);
  return () => fs.rmSync(dir, { recursive: true, force: true });
}

declare module "vitest" {
  export interface ProvidedContext {
    templateDb: string;
  }
}
