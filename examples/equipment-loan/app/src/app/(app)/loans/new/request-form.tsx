"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import type { BorrowerType } from "@/db/schema";
import { dt02, isValuable } from "@/rules/decision-tables";
import { addDays } from "@/lib/dates";
import { Button, Card, Field, Notice, Tag, inputClass } from "@/components/ui";
import { idle } from "@/lib/action";
import { searchEquipmentAction, submitAction } from "../../actions";

type Item = Awaited<ReturnType<typeof searchEquipmentAction>>[number];

export function RequestForm({ today, borrowerType }: { today: string; borrowerType: BorrowerType }) {
  const [state, action, pending] = useActionState(submitAction, idle);
  const err = (k: string) => (!state.ok ? state.fields?.[k] : undefined);
  const [picked, setPicked] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [startDate, setStart] = useState("");
  const [dueDate, setDue] = useState("");
  const [teaching, setTeaching] = useState(false);
  // Controlled on purpose: React resets uncontrolled fields after every action, which would
  // wipe what the borrower typed whenever the server sends back a validation message.
  const [purpose, setPurpose] = useState("");
  const [location, setLocation] = useState<"" | "on" | "off">("");
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => startSearch(async () => setResults(await searchEquipmentAction(q, startDate, dueDate))), 250);
    return () => clearTimeout(t);
  }, [q, startDate, dueDate]);

  // Early hint only; the server decides (DT-02, BR-06)
  const rule = dt02({ borrowerType, teaching: borrowerType === "Teacher" && teaching, valuable: picked.some((p) => isValuable(p.unitPrice)) });
  const latest = startDate ? addDays(startDate, rule.maxDays) : undefined;

  return (
    <form action={action} className="space-y-6" noValidate>
      {!state.ok && <Notice tone="error">{state.message}</Notice>}

      <Card title={<>设备<span className="text-red-700">*</span></>}>
        <div className="space-y-3">
          {picked.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="已选择的设备">
              {picked.map((p) => (
                <li key={p.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-3 pr-1 text-sm text-blue-900 ring-1 ring-blue-200">
                  <input type="hidden" name="equipmentIds" value={p.id} />
                  {p.assetTag} {p.model}
                  {isValuable(p.unitPrice) && <Tag tone="amber">贵重</Tag>}
                  <button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="rounded-full p-1 hover:bg-blue-100" aria-label={`移除 ${p.assetTag}`}>
                    <X size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="查找设备" htmlFor="q" error={err("equipmentIds")} hint="按资产标签、型号或类别查找；先填写借用日期，可以看到设备在这段时间是否空闲。">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-500" aria-hidden />
              <input id="q" value={q} onChange={(e) => setQ(e.target.value)} className={`${inputClass} pl-9`} placeholder="例如 投影仪、CAM、三脚架" aria-invalid={!!err("equipmentIds")} />
            </div>
          </Field>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200" aria-busy={searching}>
            {results.filter((r) => !picked.some((p) => p.id === r.id)).map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setPicked([...picked, r])} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span>
                    <code className="font-medium">{r.assetTag}</code> {r.model} <span className="text-slate-600">· {r.category}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {isValuable(r.unitPrice) && <Tag tone="amber">贵重</Tag>}
                    {r.freeForPeriod === true && <Tag tone="green">该期间空闲</Tag>}
                    {r.freeForPeriod === false && <Tag tone="red">该期间已借出，可进入等待名单</Tag>}
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-600">{searching ? "正在查找…" : "没有找到设备"}</li>}
          </ul>
        </div>
      </Card>

      <Card title="借用信息">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="用途" htmlFor="purpose" required error={err("purpose")}>
              <textarea id="purpose" name="purpose" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputClass} aria-invalid={!!err("purpose")} placeholder="例如：课程作业拍摄" />
            </Field>
          </div>
          <fieldset className="space-y-1 sm:col-span-2">
            <legend className="text-sm font-medium text-slate-800">
              使用地点<span className="ml-0.5 text-red-700">*</span>
            </legend>
            <div className="flex gap-6 text-sm">
              <label className="flex min-h-10 items-center gap-2">
                <input type="radio" name="location" value="on" checked={location === "on"} onChange={() => setLocation("on")} className="h-4 w-4" /> 校内
              </label>
              <label className="flex min-h-10 items-center gap-2">
                <input type="radio" name="location" value="off" checked={location === "off"} onChange={() => setLocation("off")} className="h-4 w-4" /> 校外（需部门负责人审批）
              </label>
            </div>
            {err("offCampus") && <p className="text-sm text-red-700">{err("offCampus")}</p>}
          </fieldset>
          {borrowerType === "Teacher" && (
            <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="teaching" checked={teaching} onChange={(e) => setTeaching(e.target.checked)} className="h-4 w-4" /> 用于教学
            </label>
          )}
          <Field label="借用日期" htmlFor="startDate" required error={err("startDate")}>
            <input id="startDate" name="startDate" type="date" min={today} value={startDate} onChange={(e) => setStart(e.target.value)} className={inputClass} aria-invalid={!!err("startDate")} />
          </Field>
          <Field label="预计归还日期" htmlFor="dueDate" required error={err("dueDate")} hint={`这次最多可借 ${rule.maxDays} 天${latest ? `，最晚 ${latest} 归还` : ""}`}>
            <input id="dueDate" name="dueDate" type="date" min={startDate || today} max={latest} value={dueDate} onChange={(e) => setDue(e.target.value)} className={inputClass} aria-invalid={!!err("dueDate")} />
          </Field>
        </div>
      </Card>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "正在提交…" : "提交申请"}
      </Button>
    </form>
  );
}
