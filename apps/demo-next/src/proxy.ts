import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import type { NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  return nextgenMiddleware(req, {
    issuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
    proxyPath: "/__nextgen",
    protectedRoutes: ["/admin"],
    loginPath: "/login",
  });
}

export const config = {
  matcher: ["/__nextgen/:path*", "/admin", "/admin/:path*", "/login"],
};
