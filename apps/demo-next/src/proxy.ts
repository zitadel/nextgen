import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import type { NextRequest } from "next/server";

import { DEMO_PROJECT_ID } from "./project";

export function proxy(req: NextRequest) {
  return nextgenMiddleware(req, {
    url: process.env.ZITADEL_URL ?? "http://localhost:8080",
    projectId: DEMO_PROJECT_ID,
    // `/dashboard` is not the login page's post-sign-in URL, so a sign-in
    // that starts there shows the widget returning to the page it came from.
    protectedRoutes: ["/admin", "/dashboard"],
    loginPath: "/login",
  });
}

export const config = {
  matcher: ["/__nextgen/:path*", "/admin", "/admin/:path*", "/dashboard", "/login"],
};
