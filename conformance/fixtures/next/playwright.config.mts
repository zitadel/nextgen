import { defineConfig } from "@playwright/test";
import { conformanceConfig } from "@zitadel/conformance/config";
import { nextAppEnv } from "@zitadel/testing/playwright";

// proxy.ts hands ZITADEL_URL to the SDK's middleware, which reads
// ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET itself, and the pages read
// NEXT_PUBLIC_ZITADEL_PROJECT_ID. The kit's Next.js template sets all four.
export default defineConfig(conformanceConfig({ configDir: import.meta.dirname, env: nextAppEnv }));
