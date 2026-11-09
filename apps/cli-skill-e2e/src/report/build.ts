import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { DEFAULT_SIM_MODEL } from "../defaults.ts";
import { gradeConfig, listCells } from "../grading.ts";
import { journeyNames, loadJourney } from "../journey.ts";
import { packageRoot } from "../paths.ts";
import { type GradedRun, groupRuns } from "./metrics.ts";
import { type RunMeta, renderReport } from "./render.ts";

const git = (...args: ReadonlyArray<string>): string => {
  try {
    return execFileSync("git", args, {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

interface Recorded {
  readonly modelId: string;
  readonly cli: string;
  readonly skill: string;
}

/**
 * What the test recorded about a run in `run.json`: the exact model, and the
 * CLI and skill it had. The folder name is only the scenario's.
 */
function recordedRun(dir: string, fallbackModel: string): Recorded {
  try {
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as {
      readonly scenario: { readonly model: string };
      readonly cli?: string;
      readonly skill?: string;
    };
    return {
      modelId: run.scenario.model,
      cli: run.cli ?? "unknown",
      skill: run.skill ?? "unknown",
    };
  } catch {
    return { modelId: fallbackModel, cli: "unknown", skill: "unknown" };
  }
}

const distinct = (values: ReadonlyArray<string>): string => [...new Set(values)].join(", ");

const runMeta = (): RunMeta => ({
  generatedAt: new Date().toISOString(),
  host: hostname(),
  node: process.version,
  simModel: process.env.SIM_MODEL ?? DEFAULT_SIM_MODEL,
  branch: process.env.BRANCH ?? git("rev-parse", "--abbrev-ref", "HEAD"),
  commit: git("rev-parse", "--short", "HEAD"),
  dirty: git("status", "--porcelain") !== "",
});

/** The journeys that have results under `outDir`. */
export const journeysWithResults = (outDir: string): ReadonlyArray<string> =>
  journeyNames().filter((name) => existsSync(join(outDir, name)));

/** Grade every run of one journey under `outDir` and write its `journey.html` beside them; returns its path. */
export function buildReport(outDir: string, journeyName: string): string {
  const { stages } = loadJourney(journeyName);
  const journeyDir = join(outDir, journeyName);
  const runs: ReadonlyArray<GradedRun> = listCells(journeyDir, ["with-skill", "baseline"]).map(
    (cell) => ({
      ...cell,
      ...recordedRun(cell.dir, cell.model),
      rows: gradeConfig(cell.dir, stages),
    }),
  );
  const html = renderReport({
    journey: journeyName,
    stages,
    groups: groupRuns(runs),
    modelsUsed: distinct(runs.map((run) => run.modelId)),
    cliVersions: distinct(runs.map((run) => run.cli)),
    skillVersions: distinct(runs.map((run) => run.skill)),
    meta: runMeta(),
  });
  const destination = join(journeyDir, "journey.html");
  writeFileSync(destination, html);
  return destination;
}
