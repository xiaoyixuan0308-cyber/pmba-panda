import { redirect } from "next/navigation";
import { HOME, currentActor } from "@/auth/session";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

const DEMO = [
  ["学生（借用人）", "student@demo.local"],
  ["教师（借用人）", "teacher@demo.local"],
  ["办事员", "clerk@demo.local"],
  ["设备管理员", "manager@demo.local"],
  ["部门负责人", "depthead@demo.local"],
];

export default async function LoginPage() {
  const a = await currentActor();
  if (a) redirect(HOME[a.role]);
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">设备借用系统</h1>
      <p className="mb-6 text-sm text-slate-600">传媒中心设备室 · 原型，所有人员和数据均为虚构</p>
      <Card>
        <LoginForm />
      </Card>
      <Card title="演示账号" className="mt-6">
        <p className="mb-2 text-sm text-slate-600">密码统一为 demo1234，仅用于演示。</p>
        <ul className="divide-y divide-slate-100 text-sm">
          {DEMO.map(([role, email]) => (
            <li key={email} className="flex justify-between gap-2 py-1.5">
              <span className="text-slate-700">{role}</span>
              <code className="text-slate-900">{email}</code>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
