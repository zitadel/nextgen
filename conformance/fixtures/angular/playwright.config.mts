import { defineConfig } from "@playwright/test";
import { conformanceConfig } from "@zitadel/conformance/config";
import type { AppEnvTemplate } from "@zitadel/testing/playwright";

// What the app setup wrote reads: the dev script's zitadel-ng.cjs takes
// ZITADEL_PROJECT_ID from the process environment and writes it into the
// git-ignored src/app/zitadel-project.ts, which app.ts imports; proxy.conf.cjs,
// which `ng serve` loads, takes ZITADEL_URL, ZITADEL_PROJECT_SECRET and
// ZITADEL_PROJECT_ID (the session cookie's name) from it too. Both read the
// environment before .env.local. The kit has no Angular template; this is it.
const angularAppEnv: AppEnvTemplate = {
  ZITADEL_URL: "baseUrl",
  ZITADEL_PROJECT_ID: "projectId",
  ZITADEL_PROJECT_SECRET: "projectSecret",
};

export default defineConfig(conformanceConfig({ configDir: import.meta.dirname, env: angularAppEnv }));
