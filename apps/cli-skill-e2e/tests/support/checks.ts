import { copyFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentClient, CheckResult } from "./agent-client";
import { evalAssertion } from "./lib";
import { journey, type Stage } from "./journey";

const CLI_SPEC = process.env.CLI_SPEC || journey.cliSpec || "@zitadel/cli@latest";

type Read = { json: unknown } | { err: string };

/** Ask the live instance, from inside the container, what a read command returns. */
async function read(agent: AgentClient, get: string): Promise<Read> {
  const run = await agent.exec({
    file: "npx",
    args: ["-y", CLI_SPEC, ...get.split(" ").filter(Boolean), "--non-interactive", "--json"],
  });
  if (run.status !== 0) {
    return { err: (run.stderr || run.stdout || `exit ${run.status}`).trim().slice(0, 300) };
  }
  try {
    return { json: JSON.parse(run.stdout || "{}") };
  } catch {
    return { err: "non-JSON output" };
  }
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
): Promise<CheckResult[]> {
  const cache = new Map<string, Read>();
  const results: CheckResult[] = [];
  for (const assertion of stage.assert ?? []) {
    if (!cache.has(assertion.get)) {
      cache.set(assertion.get, await read(agent, assertion.get));
    }
    const got = cache.get(assertion.get) as Read;
    if ("err" in got) {
      results.push({
        name: assertion.name,
        passed: false,
        evidence: `\`${assertion.get}\` → ${got.err}`,
      });
      continue;
    }
    const { passed, actual } = evalAssertion(got.json, assertion);
    const shownPath = Array.isArray(assertion.path) ? assertion.path.join(" | ") : assertion.path;
    results.push({
      name: assertion.name,
      passed,
      evidence: `\`${assertion.get}\` → ${shownPath} = ${actual}`,
    });
  }
  if (stage.app) {
    results.push(...(await agent.checkApp(stage.app, stage.id)));
  }
  if (results.length === 0) {
    return results;
  }
  writeFileSync(
    join(resultsDir, `asserts-stage${stage.id}.json`),
    JSON.stringify({ stage: stage.id, results }, null, 2),
  );
  // When an assertion's `path` is wrong, the pass/fail line cannot show where
  // the value really lives — the raw responses can.
  writeFileSync(
    join(resultsDir, `asserts-raw-stage${stage.id}.json`),
    JSON.stringify(
      Object.fromEntries([...cache].map(([get, got]) => [get, "json" in got ? got.json : got])),
      null,
      2,
    ),
  );
  return results;
}

/** Has a Zitadel project been established in the workspace yet? */
export function hasProject(workDir: string): boolean {
  if (existsSync(join(workDir, "zitadel.json"))) {
    return true;
  }
  try {
    return readdirSync(join(workDir, ".zitadel/schemas")).some(
      (name) => /human-user/.test(name) && name.endsWith(".json"),
    );
  } catch {
    return false;
  }
}

/** Keep the human-user schema the stage produced, for the report's before/after. */
export function snapshotSchema(workDir: string, resultsDir: string, stageId: number): void {
  try {
    const dir = join(workDir, ".zitadel/schemas");
    const file = readdirSync(dir).find((name) => /human-user/.test(name) && name.endsWith(".json"));
    if (file) {
      copyFileSync(join(dir, file), join(resultsDir, `after-stage${stageId}.json`));
    }
  } catch {
    // no schema yet: the stage may not have created a project
  }
}
