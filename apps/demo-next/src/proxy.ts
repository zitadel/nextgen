import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import type { NextRequest } from "next/server";

import { DEMO_PROJECT_ID } from "./project";

export function proxy(req: NextRequest) {
  return nextgenMiddleware(req, {
    url: process.env.ZITADEL_URL ?? "http://localhost:8080",
    projectId: DEMO_PROJECT_ID,
    protectedRoutes: ["/admin"],
    loginPath: "/login",
  });
}

export const config = {
  matcher: ["/__nextgen/:path*", "/admin", "/admin/:path*", "/login"],
};
