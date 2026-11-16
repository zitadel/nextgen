import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { test as base } from "@playwright/test";

import { type Envelope, harness, type Running, runZitadel, spawnCli } from "./cli";

/** Starts `zitadel <args>` in a directory and leaves it running. */
export type Start = (args: string[], cwd: string) => Running;

/** Runs `zitadel <args> --non-interactive --json` in a directory and returns its envelope. */
export type Zitadel = (args: string[], cwd: string) => Promise<Envelope & { transcript: string }>;

/**
 * `test` with the fixtures of the CLI deployment suite.
 *
 * - `start` starts a `zitadel` process; every process it started is killed when the test ends,
 *   whether the test passed or not.
 * - `zitadel` runs one command to its end through `start`, so it is killed with the others.
 * - `app` is a new empty directory for the worker, under a name `setup` accepts as the new app's
 *   package name, removed when the worker is done. A retry runs in a new worker, so it gets a new
 *   one.
 */
export const test = base.extend<{ start: Start; zitadel: Zitadel }, { app: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument.
  start: async ({}, use) => {
    const started: Running[] = [];
    await use((args, cwd) => {
      const running = spawnCli(args, cwd);
      started.push(running);
      return running;
    });
    await Promise.all(
      started.map((running) => {
        return running.kill();
      }),
    );
  },
  zitadel: async ({ start }, use) => {
    await use((args, cwd) => runZitadel(args, cwd, start));
  },
  app: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument.
    async ({}, use) => {
      const attempt = await mkdtemp(join(harness().dir, "attempt-"));
      const app = join(attempt, "cloud-app");
      await mkdir(app);
      await use(app);
      await rm(attempt, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
});
