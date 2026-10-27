import { readFile } from "node:fs/promises";

/**
 * Where a journey lane spends its time. A task runner may hold a task's output
 * back until the task ends — moon's buffered style did, and every line of the
 * CI journey then carried the same timestamp (run 38585094551) — so the runner
 * stamps its own lines with the time since it started and ends with a
 * lane × phase table, whichever runner runs it.
 *
 * A phase is `{ phase, ms, ok }`. prepare-app, a child process of the runner,
 * writes the phases of its CLI steps to `timings.json` in the lane's work dir;
 * the runner adds them to the lane's own.
 */

/**
 * The table's phase columns in the order a lane runs them; a table shows the
 * ones its lanes recorded.
 *
 * - oidc-mock: starting the mock OIDC provider before prepare-app (framework
 *   lanes, when its binary is built).
 * - doctor, start, setup: prepare-app's CLI steps. doctor is the lane's first
 *   `npx`, so it includes installing the CLI into the lane's npm cache.
 * - drift: the managed-file drift probe (the fresh-app Next lane only).
 * - stop, install: the testkit lane stopping setup's instance, then installing
 *   the kit and Playwright into the app.
 * - app: the generated app's dev server, until it answers.
 * - playwright: the lane's Playwright run.
 * - teardown: stopping the app and resetting the local runtime.
 */
export const PHASES = [
  "oidc-mock",
  "doctor",
  "start",
  "setup",
  "drift",
  "stop",
  "install",
  "app",
  "playwright",
  "teardown",
];

/** Runs `fn` and appends how long it took to `phases`, also when it throws. */
export async function timePhase(phases, phase, fn, now = () => performance.now()) {
  const startedAt = now();
  let ok = false;
  try {
    const result = await fn();
    ok = true;
    return result;
  } finally {
    phases.push({ phase, ms: Math.round(now() - startedAt), ok });
  }
}

/**
 * The phases prepare-app wrote to `path`, or none when it wrote nothing
 * readable: a timing gap must not fail the lane.
 */
export async function readPhases(path, readFileFn = readFile) {
  try {
    const phases = JSON.parse(await readFileFn(path, "utf8"));
    return Array.isArray(phases) ? phases : [];
  } catch {
    return [];
  }
}

/** `ms` as `m:ss`: the stamp on the runner's lines and the table's `began`. */
export function formatOffset(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Phases as `browsers 1.2s, registry 12.0s`. */
export function formatPhases(phases) {
  return phases.map(({ phase, ms }) => `${phase} ${seconds(ms)}s`).join(", ");
}

/**
 * The lane × phase table as rows of cells, the header first, then one row per
 * lane in the order given. A lane is `{ id, began, ended, failed, phases }`,
 * with `began` and `ended` read from the runner's clock, so `began` matches
 * the stamps on its log lines. Durations are seconds; a phase the lane did not
 * run is "-", and a failed lane's result names the phase that failed.
 */
export function timingTable(lanes) {
  const recorded = new Set(lanes.flatMap((lane) => lane.phases.map(({ phase }) => phase)));
  const columns = [
    ...PHASES.filter((phase) => recorded.has(phase)),
    // A phase someone added without listing it still gets a column.
    ...[...recorded].filter((phase) => !PHASES.includes(phase)),
  ];
  return [
    ["lane", "began", ...columns, "total", "result"],
    ...lanes.map((lane) => [
      lane.id,
      formatOffset(lane.began),
      ...columns.map((column) => phaseCell(lane.phases, column)),
      seconds(lane.ended - lane.began),
      laneResult(lane),
    ]),
  ];
}

/** The rows as plain text: lane and result left-aligned, the times right-aligned. */
export function formatTextTable(rows) {
  const last = rows[0].length - 1;
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === 0 || column === last
            ? cell.padEnd(widths[column])
            : cell.padStart(widths[column]),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** The rows as a markdown table, aligned like the text one. */
export function formatMarkdownTable(rows) {
  const [header, ...body] = rows;
  const last = header.length - 1;
  const alignment = header.map((_, column) => (column === 0 || column === last ? ":--" : "--:"));
  return [header, alignment, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function phaseCell(phases, column) {
  const runs = phases.filter(({ phase }) => phase === column);
  return runs.length === 0 ? "-" : seconds(runs.reduce((sum, { ms }) => sum + ms, 0));
}

function laneResult(lane) {
  if (!lane.failed) return "passed";
  const failedPhase = lane.phases.find(({ ok }) => !ok);
  return failedPhase ? `failed in ${failedPhase.phase}` : "failed";
}

function seconds(ms) {
  return (ms / 1000).toFixed(1);
}
