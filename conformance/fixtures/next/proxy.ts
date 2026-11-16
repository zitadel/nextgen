// zitadel-cli: managed-file v1
import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import type { NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  return nextgenMiddleware(req, {
    url: process.env.ZITADEL_URL,
    // The routes that need a sign-in. To protect another, add it here; a
    // trailing * covers every path that starts with it, as in "/orders*".
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  });
}

export const config = {
  // Every route but Next.js's build files and favicon.ico, so the list above
  // alone decides what needs a sign-in, and auth() sees the session on every
  // page. A protected route that a narrower matcher leaves out stays public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
