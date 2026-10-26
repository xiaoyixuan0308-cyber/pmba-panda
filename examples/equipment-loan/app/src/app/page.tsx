import { redirect } from "next/navigation";
import { HOME, requireActor } from "@/auth/session";

export default async function Root() {
  const a = await requireActor();
  redirect(HOME[a.role]);
}
