"use server";
/**
 * Server actions: every button in the UI ends here. Each one re-checks the
 * signed-in user and calls the domain service, which enforces permissions,
 * guards and rules (the UI only hides what the user cannot do).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ctxFor, requireActor } from "@/auth/session";
import { updateSetting } from "@/domain/admin";
import { runDailyChecks } from "@/domain/loan/daily";
import { equipmentChoices } from "@/domain/loan/queries";
import { approve, cancel, checkOut, moveToWaitlist, recordReturn, reject, signAgreement, submitRequest, withdraw } from "@/domain/loan/service";
import { SETTING_KEYS, type SettingKey } from "@/domain/settings";
import { run, type ActionResult } from "@/lib/action";

const ctx = async () => ctxFor(await requireActor());
const id = (f: FormData) => Number(f.get("loanId"));
const done = (r: ActionResult) => {
  revalidatePath("/", "layout");
  return r;
};

export async function submitAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  const c = await ctx();
  let created: { loanId: number; loanNo: string } | null = null;
  const r = run(() => {
    created = submitRequest(c, {
      equipmentIds: f.getAll("equipmentIds").map(Number),
      purpose: String(f.get("purpose") ?? ""),
      offCampus: f.get("location") === "off" ? true : f.get("location") === "on" ? false : undefined,
      teaching: f.get("teaching") === "on",
      startDate: String(f.get("startDate") ?? ""),
      dueDate: String(f.get("dueDate") ?? ""),
    });
  });
  if (!r.ok || !created) return r;
  revalidatePath("/", "layout");
  redirect(`/loans/${(created as { loanId: number }).loanId}?created=1`);
}

export async function withdrawAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  return done(run(() => {
    withdraw(c, id(f));
    return "已撤回。";
  }));
}
export async function signAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  if (f.get("agree") !== "on") return { ok: false, message: "请先阅读并勾选同意借用协议。", fields: { agree: "请勾选" }, at: Date.now() } as ActionResult;
  return done(run(() => {
    signAgreement(c, id(f));
    return "借用协议已签署，请在借用日期到设备室领取。";
  }));
}
export async function approveAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  return done(run(() => (approve(c, id(f), String(f.get("comment") ?? "")).status === "Approved" ? "已批准，已通知借用人。" : "已同意，等待部门负责人审批。")));
}
export async function rejectAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  return done(run(() => {
    reject(c, id(f), String(f.get("reason") ?? ""));
    return "已拒绝，已通知借用人。";
  }));
}
export async function waitlistAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  return done(run(() => {
    moveToWaitlist(c, id(f));
    return "已转入等待名单，已通知借用人。";
  }));
}
export async function cancelAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  return done(run(() => {
    cancel(c, id(f), String(f.get("reason") ?? ""));
    return "已取消，已通知借用人。";
  }));
}
export async function checkOutAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  return done(run(() => {
    checkOut(c, id(f));
    return "已借出。";
  }));
}
export async function returnAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  return done(run(() => {
    recordReturn(c, id(f), { feePaid: f.get("feePaid") === "on" });
    return "已办理归还。";
  }));
}
export async function runChecksAction(): Promise<ActionResult> {
  const c = await ctx();
  return done(
    run(() => {
      const r = runDailyChecks(c);
      return `${r.today} 到期检查完成：新逾期 ${r.expired.length} 张${r.expired.length ? `（${r.expired.join("、")}）` : ""}；审批提醒 ${r.reminded.length} 条；到期前提醒 ${r.dueSoon.length} 条。`;
    }),
  );
}
export async function settingAction(_p: ActionResult, f: FormData) {
  const c = await ctx();
  const key = String(f.get("key")) as SettingKey;
  return done(run(() => `已保存：${SETTING_KEYS[key]} = ${updateSetting(c, key, String(f.get("value") ?? ""))}`));
}
export async function searchEquipmentAction(q: string, from: string, to: string) {
  const c = await ctx();
  return equipmentChoices(c, { q, from: from || undefined, to: to || undefined, limit: 30 }).map((e) => ({
    id: e.id, assetTag: e.assetTag, model: e.model, category: e.category, unitPrice: e.unitPrice, freeForPeriod: e.freeForPeriod,
  }));
}
