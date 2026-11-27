import { defineConfig } from "@playwright/test";
import { conformanceConfig } from "@zitadel/conformance/config";
import { viteAppEnv } from "@zitadel/testing/playwright";

// src/middleware.ts hands the request to the SDK's middleware, which reads
// ZITADEL_URL, ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET from the process
// environment, and the pages read VITE_ZITADEL_PROJECT_ID: the four the kit's
// Vite template sets.
export default defineConfig(conformanceConfig({ configDir: import.meta.dirname, env: viteAppEnv }));
