import { mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Failure = { name: string; status: string; detail: string };

type ReportTurboFailuresModule = {
  normalizeFailures: (summary: unknown) => Failure[];
  formatGithubAnnotations: (failures: Failure[]) => string[];
  formatStepSummary: (failures: Failure[]) => string;
  loadTurboSummary: (options?: {
    runsDir?: string;
    summaryFile?: string;
  }) => Promise<{ summary: unknown; path: string } | null>;
  reportTurboFailures: (options?: {
    runsDir?: string;
    summaryFile?: string;
    stepSummaryPath?: string;
  }) => Promise<{ failedCount: number; skipped: boolean; path?: string }>;
};

async function loadModule(): Promise<ReportTurboFailuresModule> {
  return (await import(
    new URL("../../../../../scripts/report-turbo-failures.mjs", import.meta.url).href
  )) as ReportTurboFailuresModule;
}

// Shaped after a real turbo 2.11 run summary: a failed task carries the exit
// code and turbo's error sentence under `execution`; a task skipped because a
// dependency failed has no `execution`.
function failedRunSummary() {
  return {
    execution: { command: "turbo run build", success: 0, failed: 1, attempted: 1, exitCode: 1 },
    tasks: [
      {
        taskId: "@zitadel/server#format",
        task: "format",
        package: "@zitadel/server",
        execution: {
          startTime: 1,
          endTime: 2,
          error: "command (/repo/apps/server) pnpm run format exited (1)",
          exitCode: 1,
        },
      },
      { taskId: "@zitadel/server#test", task: "test", package: "@zitadel/server" },
      {
        taskId: "@zitadel/api#build",
        task: "build",
        package: "@zitadel/api",
        execution: { startTime: 1, endTime: 2, exitCode: 0 },
      },
    ],
  };
}

describe("report-turbo-failures", () => {
  it("reports tasks with a nonzero exit code and skips the never-started ones", async () => {
    const { normalizeFailures } = await loadModule();
    expect(normalizeFailures(failedRunSummary())).toEqual([
      { name: "@zitadel/server#format", status: "failed", detail: "exit 1" },
    ]);
    expect(normalizeFailures({ tasks: [] })).toEqual([]);
    expect(normalizeFailures({})).toEqual([]);
  });

  it("annotates failures with the task id and exit code", async () => {
    const { normalizeFailures, formatGithubAnnotations } = await loadModule();
    expect(formatGithubAnnotations(normalizeFailures(failedRunSummary()))).toEqual([
      "::error title=Turbo task failed::@zitadel/server#format failed (exit 1)",
    ]);
    expect(
      formatGithubAnnotations([{ name: "a#test", status: "failed", detail: "done 50%\nok" }]),
    ).toEqual(["::error title=Turbo task failed::a#test failed (done 50%25%0Aok)"]);
  });

  it("writes a step summary from the newest run summary", async () => {
    const { reportTurboFailures } = await loadModule();
    const root = await mkdtemp(join(tmpdir(), "turbo-failures-"));
    const runsDir = join(root, ".turbo", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "old.json"), JSON.stringify({ tasks: [] }));
    await writeFile(join(runsDir, "new.json"), JSON.stringify(failedRunSummary()));
    const stale = new Date(Date.now() - 60_000);
    await utimes(join(runsDir, "old.json"), stale, stale);
    const stepSummaryPath = join(root, "summary.md");

    const result = await reportTurboFailures({ runsDir, stepSummaryPath });
    expect(result).toEqual({ failedCount: 1, skipped: false, path: join(runsDir, "new.json") });

    const summary = await readFile(stepSummaryPath, "utf8");
    expect(summary).toContain("## Failed turbo tasks");
    expect(summary).toContain("| `@zitadel/server#format` | failed | exit 1 |");
  });

  it("no-ops cleanly when no run summary exists", async () => {
    const { loadTurboSummary, reportTurboFailures } = await loadModule();
    const root = await mkdtemp(join(tmpdir(), "turbo-failures-empty-"));

    expect(await loadTurboSummary({ runsDir: join(root, "missing") })).toBeNull();
    expect(await reportTurboFailures({ runsDir: join(root, "missing") })).toEqual({
      failedCount: 0,
      skipped: true,
    });
  });
});
