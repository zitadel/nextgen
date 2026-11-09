import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inject, test as base } from "vitest";

import { type Journey, loadJourney } from "../src/journey.ts";
import type { Scenario } from "../scenarios.ts";
import type { AgentClient } from "./support/agent-client.ts";
import { cliSpecOf } from "./support/checks.ts";
import { startAgent } from "./support/container.ts";
import { seedWorkspace } from "./support/seed.ts";
import { settings } from "./support/settings.ts";
import { cliVersion, skillVersion } from "./support/versions.ts";

declare module "vitest" {
  export interface ProvidedContext {
    scenario: Scenario;
    repeat: number;
    journey: string;
  }
  /** The folder a journey test left its results in, for the report. */
  export interface TaskMeta {
    resultsDir?: string;
  }
}

const KEPT_ARTIFACTS = [".zitadel", "zitadel.json", ".env", ".env.local"] as const;

/**
 * Give the files the container wrote back to the host user, so the next run
 * (and the temp directory's removal) can delete them: the container writes as
 * root, which on a Linux host would leave files its owner cannot remove.
 */
function handBack(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined
    ? "true"
    : `chown -R ${uid}:${gid} /out /ws 2>/dev/null || true`;
}

/**
 * `test` with the fixtures a journey needs. All of them live for the whole
 * test file, because the journey is one stateful conversation: each stage
 * builds on the project the stage before it left behind.
 *
 * - `scenario`, `repeat` and `journey` say which model/skill combination,
 *   which run of it, and which starting point and questions this Vitest
 *   project is.
 * - `dir` is a fresh temp directory, mounted into the container and removed
 *   when the file is done.
 * - `workspace` is its `work` folder, the agent's working directory: where
 *   the app gets scaffolded, readable from the host.
 * - `results` is where this run's trajectories, check results and logs go,
 *   laid out the way the report reads them
 *   (`<journey>/<config>/<scenario>/r<repeat>`).
 * - `agent` is the running container's agent server, stopped when the file is
 *   done. Starting it also puts the journey's starting app in the workspace,
 *   when it has one, and records which model, CLI and skill the run had.
 */
export const test = base.extend<{
  scenario: Scenario;
  repeat: number;
  journey: Journey;
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
  repeat: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      await use(inject("repeat"));
    },
    { scope: "file" },
  ],
  journey: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      await use(loadJourney(inject("journey")));
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
    async ({ scenario, repeat, journey }, use) => {
      const config = scenario.skill ? "with-skill" : "baseline";
      const dir = join(settings.outDir, journey.name, config, scenario.name, `r${repeat}`);
      await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
        throw new Error(
          `could not clear ${dir}: a container from an earlier run may have left root-owned files in it (${error instanceof Error ? error.message : String(error)})`,
        );
      });
      await mkdir(dir, { recursive: true });
      if (settings.stages !== undefined) {
        await writeFile(join(dir, "stages-run.json"), JSON.stringify([...settings.stages]));
      }
      await use(dir);
    },
    { scope: "file" },
  ],
  agent: [
    async ({ scenario, repeat, journey, dir, workspace, results }, use) => {
      const running = await startAgent({ workDir: dir, outDir: results, skill: scenario.skill });
      try {
        if (journey.start !== undefined) {
          await seedWorkspace(running.client, workspace, journey.start);
        }
        await writeFile(
          join(results, "run.json"),
          JSON.stringify(
            {
              scenario,
              repeat,
              startedAt: new Date().toISOString(),
              cli: await cliVersion(running.client, cliSpecOf(journey)),
              skill: scenario.skill ? await skillVersion(running.client) : "none",
            },
            null,
            2,
          ),
        );
        await use(running.client);
      } finally {
        // Exported from inside the container: setup writes private files a host
        // user may not be able to read through the mount. Stopping comes last,
        // whatever the export did.
        await running.client
          .exec({
            file: "bash",
            args: [
              "-lc",
              `mkdir -p /out/artifacts && cp -r ${KEPT_ARTIFACTS.join(" ")} /out/artifacts/ 2>/dev/null || true; ${handBack()}`,
            ],
          })
          .catch(() => undefined);
        running.stop();
      }
    },
    { scope: "file" },
  ],
});

export { test as it };
