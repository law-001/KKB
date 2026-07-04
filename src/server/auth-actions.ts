"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, tables } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";

export interface AuthFormState {
  error?: string;
  sent?: boolean;
}

async function siteOrigin() {
  const h = await headers();
  return h.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Sends a magic link. `next` is where the callback route lands the user afterward. */
export async function signInWithMagicLink(
  next: string,
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !email.includes("@")) return { error: "Enter a valid email" };

  const supabase = await createClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message };
  return { sent: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export interface ProfileFormState {
  error?: string;
}

const nameLimit = 80;

/** One-time (or anytime) display-name update — magic link carries no name. */
export async function setDisplayName(
  next: string,
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required" };
  if (name.length > nameLimit) return { error: "Name is too long" };

  await db.update(tables.users).set({ name }).where(eq(tables.users.id, user.id));
  redirect(next || "/groups");
}
