import { defineConfig } from "@playwright/test";
import { conformanceConfig } from "@zitadel/conformance/config";
import { viteAppEnv } from "@zitadel/testing/playwright";

// The dev proxy setup wrote into vite.config.ts reads ZITADEL_URL,
// ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET; src/app.tsx reads
// VITE_ZITADEL_PROJECT_ID. The kit's Vite template sets all four.
export default defineConfig(conformanceConfig({ configDir: import.meta.dirname, env: viteAppEnv }));
