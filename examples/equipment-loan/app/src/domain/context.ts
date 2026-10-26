import { eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { people, type StaffRole } from "@/db/schema";
import { mockRegistry } from "@/adapters/asset-registry/mock";
import type { AssetRegistry } from "@/adapters/asset-registry";
import { atLocal } from "@/lib/dates";
import { DomainError } from "./errors";
import { getSetting } from "./settings";

export type Role = "Borrower" | StaffRole | "System";

export interface Actor {
  id: number | null; // null for the system (daily checks)
  role: Role;
}

export const SYSTEM: Actor = { id: null, role: "System" };

export interface Ctx {
  db: Db;
  actor: Actor;
  /** The business date (the demo can simulate it, build plan section 4). */
  today: string;
  /** The moment of the operation, on `today`. */
  now: Date;
  registry: AssetRegistry;
}

export function actorFor(db: Db, personId: number): Actor {
  const p = db.select().from(people).where(eq(people.id, personId)).get();
  if (!p) throw new DomainError("NOT_FOUND", "找不到该用户。");
  return { id: p.id, role: p.kind === "borrower" ? "Borrower" : p.staffRole! };
}

/** Build a context for an operation. `at` overrides the time of day (tests). */
export function makeCtx(db: Db, actor: Actor, opts: { registry?: AssetRegistry; time?: [number, number] } = {}): Ctx {
  const today = getSetting(db, "simulatedToday");
  const wall = new Date();
  const [h, m] = opts.time ?? [((wall.getUTCHours() + 8) % 24), wall.getUTCMinutes()];
  return { db, actor, today, now: atLocal(today, h, m), registry: opts.registry ?? mockRegistry(db) };
}
