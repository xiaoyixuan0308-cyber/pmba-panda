/** NFUS1 AC3 — sign-in with lockout after 5 failures for 15 minutes. */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { people } from "@/db/schema";
import { actorFor, type Actor } from "@/domain/context";
import { DomainError } from "@/domain/errors";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const BAD = "邮箱或密码不正确。";

export function authenticate(db: Db, email: string, password: string, now = new Date()): Actor {
  const p = db.select().from(people).where(eq(people.email, email.trim().toLowerCase())).get();
  if (!p) throw new DomainError("BAD_CREDENTIALS", BAD, "NFUS1");
  if (p.lockedUntil && p.lockedUntil > now) {
    const mins = Math.ceil((p.lockedUntil.getTime() - now.getTime()) / 60000);
    throw new DomainError("ACCOUNT_LOCKED", `连续登录失败次数过多，账号已锁定，请 ${mins} 分钟后再试。`, "NFUS1");
  }
  if (!bcrypt.compareSync(password, p.passwordHash)) {
    const failed = (p.lockedUntil && p.lockedUntil <= now ? 0 : p.failedLogins) + 1;
    const lock = failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null;
    db.update(people).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock }).where(eq(people.id, p.id)).run();
    if (lock) throw new DomainError("ACCOUNT_LOCKED", `连续 ${MAX_FAILED_LOGINS} 次登录失败，账号已锁定 ${LOCK_MINUTES} 分钟。`, "NFUS1");
    throw new DomainError("BAD_CREDENTIALS", BAD, "NFUS1");
  }
  db.update(people).set({ failedLogins: 0, lockedUntil: null }).where(eq(people.id, p.id)).run();
  return actorFor(db, p.id);
}
