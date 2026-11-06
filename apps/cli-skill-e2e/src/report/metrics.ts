import type { GradedStage } from "../grading.ts";
import type { Cell } from "../grading.ts";
import type { Stage } from "../journey.ts";

/** A graded run, with the exact model, CLI and skill it had. */
export interface GradedRun extends Cell {
  readonly modelId: string;
  readonly cli: string;
  readonly skill: string;
  readonly rows: ReadonlyArray<GradedStage>;
}

/** The repeats of one scenario. */
export interface Group {
  readonly key: string;
  readonly config: string;
  readonly model: string;
  readonly cells: ReadonlyArray<GradedRun>;
}

export interface StageTally {
  readonly id: number;
  readonly pass: number;
}

export interface Metrics {
  readonly runs: number;
  readonly verified: number;
  readonly tokensAll: number;
  readonly medianMs: number;
  readonly falseRuns: number;
  readonly perStage: ReadonlyArray<StageTally>;
}

const sum = (values: ReadonlyArray<number>): number => values.reduce((a, b) => a + b, 0);

export function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export const percent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((100 * part) / whole)}%` : "—";

/** Group runs by scenario, each group holding its repeats in order. */
export function groupRuns(runs: ReadonlyArray<GradedRun>): ReadonlyArray<Group> {
  const keyOf = (run: GradedRun): string =>
    `${run.config}__${run.model}__${run.modelId}__${run.cli}__${run.skill}`;
  const keys = [...new Set(runs.map(keyOf))];
  return keys.map((key) => {
    const cells = runs
      .filter((run) => keyOf(run) === key)
      .toSorted((a, b) => a.rep.localeCompare(b.rep));
    const [first] = cells as [GradedRun, ...GradedRun[]];
    return { key, config: first.config, model: first.model, cells };
  });
}

/**
 * The per-scenario figures over a group's repeats: verified success, the
 * share of runs where the agent finished cleanly yet a check failed (a false
 * completion), median time to a verified run, and the tokens spent, failed
 * attempts included.
 */
export function metricsFor(group: Group, stages: ReadonlyArray<Stage>): Metrics {
  const perRun = group.cells.map((cell) => ({
    // Verified means every stage of the journey passed: a run that chose a
    // subset of stages is not a verified journey.
    allPass: cell.rows.every((row) => row.status === "pass"),
    tokens: sum(cell.rows.map((row) => row.tokens)),
    ms: sum(cell.rows.map((row) => row.ms)),
    falseComplete: cell.rows.some(
      (row) => row.status === "fail" && !(row.parsed.result.is_error ?? true),
    ),
  }));
  return {
    runs: perRun.length,
    verified: perRun.filter((run) => run.allPass).length,
    tokensAll: sum(perRun.map((run) => run.tokens)),
    medianMs: median(perRun.filter((run) => run.allPass).map((run) => run.ms)),
    falseRuns: perRun.filter((run) => run.falseComplete).length,
    perStage: stages.map((stage) => ({
      id: stage.id,
      pass: group.cells.filter(
        (cell) => cell.rows.find((row) => row.stage === stage.id)?.status === "pass",
      ).length,
    })),
  };
}
