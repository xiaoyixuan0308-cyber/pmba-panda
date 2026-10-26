"use server";
import { redirect } from "next/navigation";
import { authenticate } from "@/auth/login";
import { HOME, endSession, startSession } from "@/auth/session";
import { db } from "@/db/client";
import { DomainError } from "@/domain/errors";

export async function login(_prev: { message?: string }, form: FormData): Promise<{ message?: string }> {
  let home: string;
  try {
    const actor = authenticate(db, String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    await startSession(actor.id!);
    home = HOME[actor.role];
  } catch (e) {
    if (e instanceof DomainError) return { message: e.message };
    throw e;
  }
  redirect(home);
}

export async function logout() {
  await endSession();
  redirect("/login");
}
