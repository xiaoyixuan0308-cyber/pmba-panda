import { localDateOf } from "./dates";

export const fmtDateTime = (d: Date | null | undefined) => {
  if (!d) return "—";
  const local = new Date(d.getTime() + 8 * 3600_000);
  return `${localDateOf(d)} ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};
export const fmtMoney = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
