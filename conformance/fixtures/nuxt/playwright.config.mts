import { defineConfig } from "@playwright/test";
import { conformanceConfig } from "@zitadel/conformance/config";
import type { AppEnvTemplate } from "@zitadel/testing/playwright";

// What the app setup wrote reads: the @zitadel/sdk-nuxt module, which
// nuxt.config.ts registers, takes ZITADEL_URL, ZITADEL_PROJECT_SECRET and
// NUXT_PUBLIC_ZITADEL_PROJECT_ID from the process environment in `nuxt dev`,
// and its server handler holds sessions to ZITADEL_PROJECT_ID. The kit has no
// Nuxt template; this is it.
const nuxtAppEnv: AppEnvTemplate = {
  ZITADEL_URL: "baseUrl",
  ZITADEL_PROJECT_ID: "projectId",
  ZITADEL_PROJECT_SECRET: "projectSecret",
  NUXT_PUBLIC_ZITADEL_PROJECT_ID: "projectId",
};

export default defineConfig(conformanceConfig({ configDir: import.meta.dirname, env: nuxtAppEnv }));
