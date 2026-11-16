import { defineConfig } from "@playwright/test";
import { conformanceConfig } from "@zitadel/conformance/config";
import type { AppEnvTemplate } from "@zitadel/testing/playwright";

// What the app setup wrote reads: src/routes/plugin@nextgen.ts hands the
// request to the SDK's onRequest, which takes ZITADEL_URL,
// ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET from the request's env (the
// process environment in `vite --mode ssr`), and the pages read
// PUBLIC_ZITADEL_PROJECT_ID, the prefix Qwik exposes to the browser. The kit
// has no Qwik Router template; this is it.
const qwikRouterAppEnv: AppEnvTemplate = {
  ZITADEL_URL: "baseUrl",
  ZITADEL_PROJECT_ID: "projectId",
  ZITADEL_PROJECT_SECRET: "projectSecret",
  PUBLIC_ZITADEL_PROJECT_ID: "projectId",
};

export default defineConfig(
  conformanceConfig({ configDir: import.meta.dirname, env: qwikRouterAppEnv }),
);
