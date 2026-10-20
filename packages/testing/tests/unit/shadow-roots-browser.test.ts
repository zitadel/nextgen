import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const here = import.meta.dirname;
const hasChromium = existsSync(chromium.executablePath());

/**
 * The kit's fixtures, run by the real Playwright runner against a real
 * Chromium (`tests/playwright/shadow-roots.spec.ts`): removing the roots'
 * opening from `widgetTest`, from `test` or from `authenticatedPage` fails it.
 * Skipped where Chromium is not installed; `testing:test` installs it.
 */
describe("the kit's Playwright fixtures", () => {
  it.skipIf(!hasChromium)(
    "open the closed shadow roots of every page a test gets",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kit-shadow-roots-"));
      const handshake = join(dir, "handshake.json");
      await writeFile(
        handshake,
        JSON.stringify({
          baseUrl: "http://localhost:1",
          projectId: "p",
          projectSecret: "s",
          schemaId: "x",
        }),
      );
      const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
      try {
        const result = await run(
          process.execPath,
          [cli, "test", "--config", join(here, "../playwright/playwright.config.ts")],
          { env: { ...process.env, ZITADEL_TESTING_HANDSHAKE: handshake, CI: "" } },
        ).catch((error: { stdout?: string; stderr?: string }) => {
          throw new Error(`the Playwright run failed:\n${error.stdout}\n${error.stderr}`);
        });
        expect(result.stdout).toContain("4 passed");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
