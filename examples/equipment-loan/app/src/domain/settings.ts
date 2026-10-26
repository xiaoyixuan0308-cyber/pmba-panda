/**
 * Adjustable settings (NFUS6 AC2) and demo controls (build plan section 4).
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { settings } from "@/db/schema";
import { DomainError } from "./errors";

export const SETTING_KEYS = {
  lateFeePerDay: "逾期费单价（分/天）",
  lateFeeCap: "逾期费上限（分）",
  reminderWorkingDays: "审批提醒的工作日数",
  simulatedToday: "模拟今天的日期（演示用）",
  registryAvailable: "资产登记系统是否可用（演示用）",
  registryInvalidTags: "核对不通过的资产标签（演示用）",
  agreementTermsVersion: "借用协议版本",
} as const;
export type SettingKey = keyof typeof SETTING_KEYS;

export function getSetting(db: Db, key: SettingKey): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) throw new DomainError("NOT_FOUND", `缺少设置项：${SETTING_KEYS[key]}`);
  return row.value;
}

export const getNumber = (db: Db, key: SettingKey) => Number(getSetting(db, key));

export function validateSetting(key: SettingKey, value: string): string {
  const v = value.trim();
  const positiveInt = /^[1-9]\d*$/;
  switch (key) {
    case "lateFeePerDay":
    case "lateFeeCap":
    case "reminderWorkingDays":
      if (!positiveInt.test(v)) throw new DomainError("VALIDATION", `${SETTING_KEYS[key]}必须是正整数。`, undefined, { [key]: "请输入正整数" });
      return v;
    case "simulatedToday":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
        throw new DomainError("VALIDATION", "日期格式应为 YYYY-MM-DD。", undefined, { [key]: "格式应为 YYYY-MM-DD" });
      return v;
    case "registryAvailable":
      if (v !== "true" && v !== "false") throw new DomainError("VALIDATION", "只能是 true 或 false。");
      return v;
    default:
      return v;
  }
}
