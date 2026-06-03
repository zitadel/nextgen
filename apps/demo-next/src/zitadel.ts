/**
 * Zitadel SDK initializer — single entry point for app-wide config.
 *
 * ```ts
 * import { demoProject, api, proxy } from "@/zitadel";
 * ```
 *
 * Both the server middleware and client widgets import from this file.
 */
import { configureZitadel, getApi } from "@zitadel-nextgen/api/config";
import { createProxy } from "@zitadel-nextgen/sdk-next/middleware";

export const demoProject = configureZitadel({
  apiBase: "/__nextgen",
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "demo",
  issuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
});

export const api = getApi(demoProject);

export const proxy = createProxy(demoProject, {
  protectedRoutes: ["/admin"],
  loginPath: "/login",
});
