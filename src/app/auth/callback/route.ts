import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

/** Lands here from the magic-link email, exchanges the code for a session. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/groups";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user?.email) {
      const [existing] = await db
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(eq(tables.users.id, data.user.id));

      if (!existing) {
        await db
          .insert(tables.users)
          .values({
            id: data.user.id,
            name: data.user.email.split("@")[0],
            email: data.user.email,
          })
          .onConflictDoNothing();
        const url = new URL("/welcome", origin);
        url.searchParams.set("next", next);
        return NextResponse.redirect(url);
      }

      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
