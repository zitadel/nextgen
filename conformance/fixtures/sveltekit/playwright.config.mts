import { defineConfig } from "@playwright/test";
import { conformanceConfig } from "@zitadel/conformance/config";
import type { AppEnvTemplate } from "@zitadel/testing/playwright";

// What the app setup wrote reads: src/hooks.server.ts takes ZITADEL_URL,
// ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET from $app/env/private (which
// SvelteKit fills from the process environment in dev), and the pages take
// VITE_ZITADEL_PROJECT_ID. The kit has no SvelteKit template yet; this is it.
const sveltekitAppEnv: AppEnvTemplate = {
  ZITADEL_URL: "baseUrl",
  ZITADEL_PROJECT_ID: "projectId",
  ZITADEL_PROJECT_SECRET: "projectSecret",
  VITE_ZITADEL_PROJECT_ID: "projectId",
};

export default defineConfig(
  conformanceConfig({ configDir: import.meta.dirname, env: sveltekitAppEnv }),
);
