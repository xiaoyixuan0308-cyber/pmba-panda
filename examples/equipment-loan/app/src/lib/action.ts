/** What a server action returns to a form: success, or the business message (and per-field messages). */
import { DomainError } from "@/domain/errors";

export type ActionResult = { ok: true; message?: string; at?: number } | { ok: false; message: string; fields?: Record<string, string>; at?: number };
export const idle: ActionResult = { ok: true };

export function run(fn: () => string | void): ActionResult {
  try {
    const message = fn();
    return { ok: true, message: message ?? undefined, at: Date.now() };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.message, fields: e.fields, at: Date.now() };
    console.error(e);
    return { ok: false, message: "系统出错了，请稍后再试。", at: Date.now() };
  }
}
