import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import type { NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  return nextgenMiddleware(req, {
    url: process.env.ZITADEL_URL ?? "http://localhost:8080",
    protectedRoutes: ["/admin"],
    loginPath: "/login",
  });
}

export const config = {
  matcher: ["/__nextgen/:path*", "/admin", "/admin/:path*", "/login"],
};
