/** Insert-only audit trail (NFUS2, C-04). There is no update or delete. */
import type { Db } from "@/db/open";
import { auditEntries, notifications } from "@/db/schema";
import type { Ctx } from "./context";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

export function writeAudit(
  tx: Tx,
  ctx: Ctx,
  entry: { action: string; objectType?: string; objectId: number; before?: string | null; after?: string | null },
) {
  tx.insert(auditEntries)
    .values({
      actorId: ctx.actor.id,
      action: entry.action,
      objectType: entry.objectType ?? "Loan",
      objectId: entry.objectId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      at: ctx.now,
    })
    .run();
}

/** In-app notification (change 001). Real email/IM is left to production. */
export function notify(tx: Tx, ctx: Ctx, recipientId: number, message: string, loanId: number | null = null) {
  tx.insert(notifications).values({ recipientId, loanId, message, createdAt: ctx.now }).run();
}
