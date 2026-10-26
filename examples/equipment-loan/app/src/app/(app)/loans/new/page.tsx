import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { ctxFor, requireActor } from "@/auth/session";
import { db } from "@/db/client";
import { people } from "@/db/schema";
import { RequestForm } from "./request-form";

export default async function NewLoanPage() {
  await connection();
  const actor = await requireActor(["Borrower"]);
  const ctx = ctxFor(actor);
  const me = db.select().from(people).where(eq(people.id, actor.id!)).get()!;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">提交借用申请</h1>
      <p className="text-sm text-slate-600">
        带 <span className="text-red-700">*</span> 的为必填项。
      </p>
      <RequestForm today={ctx.today} borrowerType={me.borrowerType!} />
    </div>
  );
}
