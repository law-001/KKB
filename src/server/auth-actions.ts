"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export interface AuthFormState {
  error?: string;
}

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function register(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const { name, email, password } = parsed.data;

  const existing = db
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(eq(tables.users.email, email))
    .get();
  if (existing) return { error: "An account with that email already exists" };

  const inserted = db
    .insert(tables.users)
    .values({ name, email, passwordHash: hashPassword(password) })
    .returning({ id: tables.users.id })
    .get();

  await createSession(inserted.id);
  redirect("/groups");
}

export async function login(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = db
    .select()
    .from(tables.users)
    .where(eq(tables.users.email, email))
    .get();
  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return { error: "Wrong email or password" };
  }
  await createSession(user.id);
  redirect("/groups");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
