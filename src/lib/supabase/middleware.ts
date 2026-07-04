import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth", "/join"];

function isPublicPath(pathname: string) {
  return pathname === "/" || PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Refreshes the Supabase session cookie on every request so the access
 * token never expires out from under a signed-in user — this is what makes
 * the session effectively permanent, not any single long-lived cookie.
 * Also gates every non-public route behind having a session at all; each
 * page still checks group membership itself via `requireGroupMember`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not add logic between createServerClient and getClaims() — it must run
  // on every request for the silent refresh to actually happen. getClaims()
  // still refreshes an expiring session, but verifies the JWT locally
  // (against cached JWKS) instead of calling the Auth server per request
  // the way getUser() does.
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
