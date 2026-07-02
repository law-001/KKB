import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables } from "@/lib/db";

const SESSION_COOKIE = "sw_session";
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export async function createSession(userId: string): Promise<void> {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.insert(tables.sessions).values({ token, userId, expiresAt }).run();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    db.delete(tables.sessions).where(eq(tables.sessions.token, token)).run();
  }
  jar.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = db
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      expiresAt: tables.sessions.expiresAt,
    })
    .from(tables.sessions)
    .innerJoin(tables.users, eq(tables.users.id, tables.sessions.userId))
    .where(eq(tables.sessions.token, token))
    .all();
  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now() || !row.email) return null;
  return { id: row.id, name: row.name, email: row.email };
}

/** For pages/actions that require a signed-in user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
