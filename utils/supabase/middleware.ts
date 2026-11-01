import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function createClient(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        },
      },
    },
  );

  // Creating the client alone does not refresh sessions.
  await supabase.auth.getClaims();

  // Forward refreshed cookies to the Server Component as well as the browser.
  const forwarded = NextResponse.next({ request });
  response.cookies.getAll().forEach(cookie => forwarded.cookies.set(cookie));
  for (const name of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(name);
    if (value) forwarded.headers.set(name, value);
  }
  return forwarded;
}
