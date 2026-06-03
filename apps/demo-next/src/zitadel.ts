/**
 * Zitadel SDK initializer — single entry point for app-wide config.
 *
 * ```ts
 * import { demoProject, api, proxy } from "@/zitadel";
 * ```
 *
 * Both the server middleware and client widgets import from this file.
 */
import { configureZitadel, getApi } from "@zitadel/api/config";
import { createProxy } from "@zitadel/sdk-next/middleware";

export const demoProject = configureZitadel({
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "proj_demo",
  url: process.env.ZITADEL_URL ?? "http://localhost:8080",
});

export const api = getApi(demoProject);

export const proxy = createProxy(demoProject, {
  protectedRoutes: ["/admin"],
  loginPath: "/login",
});
