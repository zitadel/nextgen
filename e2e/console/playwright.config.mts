import { defineConfig } from "@playwright/test";
import {
  chromiumProjects,
  e2eActionTimeouts,
  e2eTimeouts,
  e2eTrace,
  workspaceRoot,
} from "../playwright.shared";

/**
 * Embedded shell smoke: the built console under its production embed base,
 * served by `vite preview` with no backend (see `src/console-shell.spec.ts`).
 */
export default defineConfig({
  ...e2eTimeouts,
  testDir: "./src",
  outputDir: "test-results/smoke",
  use: {
    ...e2eActionTimeouts,
    baseURL: "http://localhost:4173",
    trace: e2eTrace,
  },
  webServer: {
    // Preview only — the console dist is already built by the `console:build`
    // moon dependency. Building again here would rewrite the dist that the
    // real/embedded lanes' server:build embeds, racing those writers.
    command: "corepack pnpm --filter @zitadel/console run preview",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    cwd: workspaceRoot,
  },
  projects: chromiumProjects,
});
