import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { Card, Tag, inputClass, Button } from "@/components/ui";
import { LoanTable } from "@/components/loan-table";
import { counterToday } from "@/domain/loan/queries";

export default async function CounterPage() {
  await connection();
  const ctx = ctxFor(await requireActor(["Clerk"]));
  const { pickups, returns } = counterToday(ctx);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">柜台</h1>
      <form action="/loans" className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          查找借用单
        </label>
        <input id="q" name="q" className={inputClass} placeholder="借用单编号、借用人姓名或学工号、资产标签" />
        <Button type="submit">查找</Button>
      </form>
      <Card title={`今天待领取（${pickups.length}）`}>
        <LoanTable rows={pickups} empty="今天没有待领取的借用单。" extra={(r) => (pickups.find((p) => p.id === r.id)!.agreementSigned ? <Tag tone="green">已签协议</Tag> : <Tag tone="amber">未签协议</Tag>)} />
      </Card>
      <Card title={`待归还（今天到期和已逾期，${returns.length}）`}>
        <LoanTable rows={returns} empty="没有待归还的借用单。" />
      </Card>
    </div>
  );
}
