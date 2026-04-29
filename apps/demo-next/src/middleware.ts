import type { NextRequest } from "next/server";
import { nextgenMiddleware } from "@zitadel/sdk-next/server";

export function middleware(req: NextRequest) {
  return nextgenMiddleware(req, {
    backendUrl: process.env.NEXTGEN_BACKEND_URL ?? "http://localhost:4000",
    secretKey: process.env.NEXTGEN_SECRET_KEY ?? "dev-secret",
    proxyPath: "/__nextgen",
    protectedRoutes: ["/dashboard", "/dashboard/*"],
    signInUrl: "/",
  });
}

export const config = {
  matcher: ["/__nextgen/:path*", "/dashboard/:path*"],
};
