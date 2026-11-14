import { rmSync } from "node:fs";
import { join } from "node:path";

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

// `ng serve` prebundles the linked SDK into .angular/cache and reuses that
// after the SDK's dist is rebuilt. Start each run without it, as CI does
// (Angular prebundles nothing when CI is set). Workers load this file again
// while the server runs, so only the runner clears it.
if (process.env.TEST_WORKER_INDEX === undefined) {
  rmSync(join(import.meta.dirname, ".angular"), { recursive: true, force: true });
}

export default defineConfig(conformanceConfig({ configDir: import.meta.dirname, env: angularAppEnv }));
