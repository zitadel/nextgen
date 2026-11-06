import { cpSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inject, test as base } from "vitest";

import type { Scenario } from "../scenarios";
import type { AgentClient } from "./support/agent-client";
import { startAgent } from "./support/container";
import { settings } from "./support/settings";

declare module "vitest" {
  export interface ProvidedContext {
    scenario: Scenario;
  }
}

/**
 * `test` with the fixtures a journey needs. All of them live for the whole test
 * file, because the journey is one stateful conversation: each stage builds on
 * the project the stage before it left behind.
 *
 * - `scenario` is the model/skill combination this Vitest project runs.
 * - `dir` is a fresh temp directory, mounted into the container and removed
 *   when the file is done.
 * - `workspace` is its `work` folder, the agent's working directory: where the
 *   app gets scaffolded, readable from the host.
 * - `results` is where this scenario's trajectories, check results and logs go,
 *   laid out the way the report reads them (`<config>/<scenario>/r1`).
 * - `agent` is the running container's agent server, stopped when the file is done.
 */
export const test = base.extend<{
  scenario: Scenario;
  dir: string;
  workspace: string;
  results: string;
  agent: AgentClient;
}>({
  scenario: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      await use(inject("scenario"));
    },
    { scope: "file" },
  ],
  dir: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      const dir = await mkdtemp(join(tmpdir(), "zitadel-skill-eval-"));
      await use(dir);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
    { scope: "file" },
  ],
  workspace: [
    async ({ dir }, use) => {
      const workspace = join(dir, "work");
      await mkdir(workspace);
      await use(workspace);
    },
    { scope: "file" },
  ],
  results: [
    async ({ scenario }, use) => {
      const config = scenario.skill ? "with-skill" : "baseline";
      const dir = join(settings.outDir, config, scenario.name, "r1");
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "run.json"),
        JSON.stringify({ scenario, startedAt: new Date().toISOString() }, null, 2),
      );
      if (settings.stages) {
        await writeFile(join(dir, "stages-run.json"), JSON.stringify([...settings.stages]));
      }
      await use(dir);
    },
    { scope: "file" },
  ],
  agent: [
    async ({ scenario, dir, workspace, results }, use) => {
      const running = await startAgent({ workDir: dir, outDir: results, skill: scenario.skill });
      try {
        await use(running.client);
      } finally {
        const artifacts = join(results, "artifacts");
        await mkdir(artifacts, { recursive: true });
        for (const name of [".zitadel", "zitadel.json", ".env", ".env.local"]) {
          if (existsSync(join(workspace, name))) {
            cpSync(join(workspace, name), join(artifacts, name), { recursive: true });
          }
        }
        running.stop();
      }
    },
    { scope: "file" },
  ],
});

export { test as it };
