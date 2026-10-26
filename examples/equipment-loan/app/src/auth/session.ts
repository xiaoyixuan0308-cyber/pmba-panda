/** Signed session cookie (jose). The key comes from SESSION_SECRET; production refuses to start without one. */
import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { actorFor, makeCtx, type Actor, type Role } from "@/domain/context";

const COOKIE = "el_session";
const HOURS = 8;

function key() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (at least 32 characters) in production.");
  return new TextEncoder().encode("dev-only-session-secret-not-for-production-use");
}

export async function startSession(personId: number) {
  const token = await new SignJWT({ sub: String(personId) }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${HOURS}h`).sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: HOURS * 3600, secure: process.env.NODE_ENV === "production" });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentActor(): Promise<Actor | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return actorFor(db, Number(payload.sub));
  } catch {
    return null;
  }
}

/** For pages and actions: the signed-in actor, or back to the login page. */
export async function requireActor(roles?: readonly Role[]): Promise<Actor> {
  const a = await currentActor();
  if (!a) redirect("/login");
  if (roles && !roles.includes(a.role)) redirect("/");
  return a;
}

export const ctxFor = (actor: Actor) => makeCtx(db, actor);

export const HOME: Record<Role, string> = {
  Borrower: "/me",
  Clerk: "/counter",
  Manager: "/review",
  DeptHead: "/approvals",
  System: "/login",
};
