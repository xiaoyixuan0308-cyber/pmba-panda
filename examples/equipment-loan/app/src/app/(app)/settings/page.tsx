import { connection } from "next/server";
import { ctxFor, requireActor } from "@/auth/session";
import { ActionForm } from "@/components/action-form";
import { Card, inputClass } from "@/components/ui";
import { SETTING_KEYS, getSetting, type SettingKey } from "@/domain/settings";
import { settingAction } from "../actions";

const RULES: { key: SettingKey; hint: string }[] = [
  { key: "lateFeePerDay", hint: "BR-10。单位：分，1000 = 10 元。" },
  { key: "lateFeeCap", hint: "BR-10。单位：分，20000 = 200 元。" },
  { key: "reminderWorkingDays", hint: "BR-09。提交后多少个工作日仍未审批完就提醒审批人。" },
];
const DEMO: { key: SettingKey; hint: string }[] = [
  { key: "simulatedToday", hint: "演示用：系统把这一天当作今天。改完后到审核页运行到期检查。" },
  { key: "registryAvailable", hint: "演示用：填 false 模拟资产登记系统连接不上（FUS5 AC3）。" },
  { key: "registryInvalidTags", hint: "演示用：核对不通过的资产标签，多个用逗号分隔（FUS5 AC2）。" },
];

function SettingForm({ k, hint, value }: { k: SettingKey; hint: string; value: string }) {
  return (
    <ActionForm action={settingAction} label="保存" variant="secondary" className="space-y-2">
      <input type="hidden" name="key" value={k} />
      <label htmlFor={k} className="block text-sm font-medium text-slate-800">
        {SETTING_KEYS[k]}
      </label>
      <input id={k} name="value" defaultValue={value} className={inputClass} />
      <p className="text-xs text-slate-600">{hint}</p>
    </ActionForm>
  );
}

export default async function SettingsPage() {
  await connection();
  const ctx = ctxFor(await requireActor(["Manager"]));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">设置</h1>
      <Card title="规则设置（修改后对之后的计算生效）">
        <div className="grid gap-6 md:grid-cols-3">
          {RULES.map((r) => (
            <SettingForm key={r.key} k={r.key} hint={r.hint} value={getSetting(ctx.db, r.key)} />
          ))}
        </div>
      </Card>
      <Card title="演示控制（正式系统中没有）">
        <div className="grid gap-6 md:grid-cols-3">
          {DEMO.map((r) => (
            <SettingForm key={r.key} k={r.key} hint={r.hint} value={getSetting(ctx.db, r.key)} />
          ))}
        </div>
      </Card>
    </div>
  );
}
