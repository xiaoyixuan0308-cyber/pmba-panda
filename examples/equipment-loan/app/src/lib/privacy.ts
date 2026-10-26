/** C-01, NFUS3: phone numbers are partly hidden outside the equipment room. */
import type { Actor } from "@/domain/context";
import { can } from "@/auth/permissions";

export const maskPhone = (phone: string) => (phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "****");

/** Full number for Clerk/Manager and for the person themselves. */
export const phoneFor = (viewer: Actor, ownerId: number, phone: string) =>
  can(viewer.role, "phone.readFull") || viewer.id === ownerId ? phone : maskPhone(phone);
