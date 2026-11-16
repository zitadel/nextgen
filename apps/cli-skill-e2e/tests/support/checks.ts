import { copyFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type CheckResult, evalAssertion } from "../../src/grading.ts";
import type { Assertion, Journey, Stage } from "../../src/journey.ts";
import type { AgentClient } from "./agent-client.ts";

const DEFAULT_CLI_SPEC = "@zitadel/cli@latest";

/** The CLI the checks run, and whose version is recorded: `CLI_SPEC` wins over the journey's own. */
export const cliSpecOf = (journey: Journey): string =>
  process.env.CLI_SPEC ?? journey.cliSpec ?? DEFAULT_CLI_SPEC;

type Read = { readonly json: unknown } | { readonly error: string };

/** Ask the live instance, from inside the container, what a read command returns. */
async function read(agent: AgentClient, cliSpec: string, command: string): Promise<Read> {
  const run = await agent.exec({
    file: "npx",
    args: ["-y", cliSpec, ...command.split(" ").filter(Boolean), "--non-interactive", "--json"],
  });
  if (run.status !== 0) {
    return { error: (run.stderr || run.stdout || `exit ${run.status}`).trim().slice(0, 300) };
  }
  try {
    return { json: JSON.parse(run.stdout || "{}") };
  } catch {
    return { error: "non-JSON output" };
  }
}

const shownPath = (assertion: Assertion): string =>
  typeof assertion.path === "string" ? assertion.path : assertion.path.join(" | ");

function checkAgainst(assertion: Assertion, got: Read): CheckResult {
  if ("error" in got) {
    return {
      name: assertion.name,
      passed: false,
      evidence: `\`${assertion.get}\` → ${got.error}`,
    };
  }
  const { passed, actual } = evalAssertion(got.json, assertion);
  return {
    name: assertion.name,
    passed,
    evidence: `\`${assertion.get}\` → ${shownPath(assertion)} = ${actual}`,
  };
}

/**
 * Outcome checks for a stage: what the live instance holds after the agent's
 * turn, and, when the stage names one, what the scaffolded app does in a
 * browser — never what the agent said it did. Results land in
 * `asserts-stage<N>.json` for the grader and the report.
 */
export async function runStageChecks(
  agent: AgentClient,
  stage: Stage,
  resultsDir: string,
  cliSpec: string,
): Promise<ReadonlyArray<CheckResult>> {
  const assertions = stage.assert ?? [];
  // Each distinct read once, one after another: several assertions share a read.
  const reads = new Map(
    await Array.fromAsync(
      [...new Set(assertions.map((assertion) => assertion.get))],
      async (command) => [command, await read(agent, cliSpec, command)] as const,
    ),
  );
  const results: ReadonlyArray<CheckResult> = [
    ...assertions.map((assertion) => checkAgainst(assertion, reads.get(assertion.get) as Read)),
    ...(stage.app === undefined ? [] : await agent.checkApp(stage.app, stage.id)),
  ];
  if (results.length === 0) {
    return results;
  }
  writeFileSync(
    join(resultsDir, `asserts-stage${stage.id}.json`),
    JSON.stringify({ stage: stage.id, results }, null, 2),
  );
  // When an assertion's `path` is wrong, the pass/fail line cannot show where
  // the value really lives; the raw responses can.
  writeFileSync(
    join(resultsDir, `asserts-raw-stage${stage.id}.json`),
    JSON.stringify(
      Object.fromEntries(
        [...reads].map(([command, got]) => [command, "json" in got ? got.json : got]),
      ),
      null,
      2,
    ),
  );
  return results;
}

const humanUserSchema = (workspace: string): string | undefined => {
  try {
    return readdirSync(join(workspace, ".zitadel/schemas")).find(
      (name) => /human-user/.test(name) && name.endsWith(".json"),
    );
  } catch {
    return undefined;
  }
};

/** Has a Zitadel project been established in the workspace yet? */
export const hasProject = (workspace: string): boolean =>
  existsSync(join(workspace, "zitadel.json")) || humanUserSchema(workspace) !== undefined;

/** Keep the human-user schema the stage produced, for the report's before/after. */
export function snapshotSchema(workspace: string, resultsDir: string, stageId: number): void {
  const file = humanUserSchema(workspace);
  if (file !== undefined) {
    copyFileSync(
      join(workspace, ".zitadel/schemas", file),
      join(resultsDir, `after-stage${stageId}.json`),
    );
  }
}
