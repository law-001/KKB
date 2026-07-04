import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, tables } from "@/lib/db";
import { getMemberRole } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

/** Real accounts (unlike ghost members) always have an email. */
function asCurrentUser(row: { id: string; name: string; email: string | null }): CurrentUser {
  return { id: row.id, name: row.name, email: row.email! };
}

/**
 * The signed-in user's row in our `users` table. Auto-provisions it on
 * first call if missing (defensive fallback — the auth callback route is
 * normally what creates it, see `src/app/auth/callback/route.ts`).
 *
 * Wrapped in React `cache()` so the layout, the page, and any server
 * actions in the same request share ONE lookup instead of each paying an
 * auth check + DB roundtrip. Uses `getClaims()` — verified locally against
 * the project's JWKS when it uses asymmetric signing keys — rather than
 * `getUser()`, which calls the Supabase Auth server on every request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || typeof claims.email !== "string" || !claims.email) {
    return null;
  }
  const { sub: authId, email } = claims;

  const [existing] = await db
    .select()
    .from(tables.users)
    .where(eq(tables.users.id, authId));
  if (existing) return asCurrentUser(existing);

  const [created] = await db
    .insert(tables.users)
    .values({ id: authId, name: email.split("@")[0], email })
    .onConflictDoNothing()
    .returning();
  if (created) return asCurrentUser(created);

  const [row] = await db
    .select()
    .from(tables.users)
    .where(eq(tables.users.id, authId));
  return asCurrentUser(row);
});

/** Redirect to /login if not signed in. Use at the top of protected pages/actions. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Redirect if not signed in, or signed in but not a member of this group.
 * Returns the member's role too, so pages don't need a second query for it.
 */
export async function requireGroupMember(
  groupId: string,
): Promise<CurrentUser & { role: "admin" | "member" }> {
  const user = await requireUser();
  const role = await getMemberRole(groupId, user.id);
  if (!role) redirect("/groups");
  return { ...user, role };
}
