"use client";
import { useActionState } from "react";
import { Button, Field, Notice, inputClass } from "@/components/ui";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message && <Notice tone="error">{state.message}</Notice>}
      <Field label="邮箱" htmlFor="email" required>
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </Field>
      <Field label="密码" htmlFor="password" required>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "正在登录…" : "登录"}
      </Button>
    </form>
  );
}
