"use client";
import { useActionState, type ReactNode } from "react";
import { idle, type ActionResult } from "@/lib/action";
import { Button, Notice } from "./ui";

/** A form posting to a server action; shows the business message it returns (NFUS5 AC3). */
export function ActionForm({
  action,
  loanId,
  label,
  pendingLabel,
  variant = "primary",
  children,
  className,
}: {
  action: (prev: ActionResult, f: FormData) => Promise<ActionResult>;
  loanId?: number;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idle);
  return (
    <form action={formAction} className={className ?? "space-y-3"} noValidate>
      {loanId !== undefined && <input type="hidden" name="loanId" value={loanId} />}
      {children}
      {state.at && state.message && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? (pendingLabel ?? "处理中…") : label}
      </Button>
    </form>
  );
}
