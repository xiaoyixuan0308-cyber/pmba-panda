/** NFUS6 AC2 settings page, and the borrower's own contact details (CRUD matrix: Person U(本人联系方式)). */
import { eq } from "drizzle-orm";
import { people, settings } from "@/db/schema";
import { assertCan } from "@/auth/permissions";
import { writeAudit } from "./audit";
import type { Ctx } from "./context";
import { DomainError } from "./errors";
import { getSetting, SETTING_KEYS, validateSetting, type SettingKey } from "./settings";

export function updateSetting(ctx: Ctx, key: SettingKey, value: string) {
  assertCan(ctx.actor.role, "settings.update");
  if (!(key in SETTING_KEYS)) throw new DomainError("VALIDATION", "没有这个设置项。");
  const v = validateSetting(key, value);
  return ctx.db.transaction((tx) => {
    const before = getSetting(ctx.db, key);
    tx.update(settings).set({ value: v }).where(eq(settings.key, key)).run();
    writeAudit(tx, ctx, { action: `setting ${key}`, objectType: "Setting", objectId: 0, before, after: v });
    return v;
  });
}

export function updateMyPhone(ctx: Ctx, phone: string) {
  assertCan(ctx.actor.role, "person.updateOwnContact");
  const v = phone.trim();
  if (!/^1\d{10}$/.test(v)) throw new DomainError("VALIDATION", "请填写 11 位手机号。", undefined, { phone: "请填写 11 位手机号" });
  ctx.db.update(people).set({ phone: v }).where(eq(people.id, ctx.actor.id!)).run();
  return v;
}
