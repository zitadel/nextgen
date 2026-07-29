import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type ReportMoonFailuresModule = {
  actionTarget: (action: unknown) => string | null;
  collectFailedActions: (report: unknown) => unknown[];
  formatFailureReport: (failedActions: unknown[]) => { names: string[]; text: string };
  formatGithubAnnotations: (failedActions: unknown[]) => string[];
  formatStepSummary: (failedActions: unknown[]) => string;
  loadMoonReport: (options?: {
    cacheDir?: string;
    reportPath?: string;
  }) => Promise<{ report: unknown; path: string } | null>;
  reportMoonFailures: (options?: {
    cacheDir?: string;
    reportPath?: string;
    summaryPath?: string;
  }) => Promise<{ failedCount: number; skipped: boolean; path?: string }>;
};

async function loadModule(): Promise<ReportMoonFailuresModule> {
  return (await import(
    new URL("../../../../../scripts/report-moon-failures.mjs", import.meta.url).href
  )) as ReportMoonFailuresModule;
}

function failedRunTaskReport() {
  return {
    actions: [
      {
        label: "RunTask(server:format)",
        status: "failed",
        error: "Task process exited with a non-zero exit code",
        node: {
          action: "run-task",
          params: {
            args: [],
            env: {},
            interactive: false,
            persistent: false,
            priority: 0,
            target: "server:format",
          },
        },
        operations: [],
      },
      {
        label: "RunTask(server:test)",
        status: "skipped",
        error: null,
        node: {
          action: "run-task",
          params: {
            args: [],
            env: {},
            interactive: false,
            persistent: false,
            priority: 0,
            target: "server:test",
          },
        },
        operations: [],
      },
      {
        label: "SetupToolchain",
        status: "passed",
        error: null,
        node: { action: "setup-toolchain", params: { toolchain: "go" } },
        operations: [],
      },
    ],
  };
}

describe("report-moon-failures", () => {
  it("resolves targets from run-task nodes and legacy labels", async () => {
    const { actionTarget } = await loadModule();
    expect(
      actionTarget({
        label: "RunTask(server:format)",
        node: {
          action: "run-task",
          params: { target: "server:format" },
        },
      }),
    ).toBe("server:format");
    expect(actionTarget({ label: "RunTarget(types:build)" })).toBe("types:build");
    expect(actionTarget({ label: "SetupToolchain" })).toBe("SetupToolchain");
  });

  it("collects failed, invalid, and timed-out actions only", async () => {
    const { collectFailedActions } = await loadModule();
    const failed = collectFailedActions({
      actions: [
        { label: "RunTask(a:lint)", status: "failed" },
        { label: "RunTask(a:test)", status: "invalid" },
        { label: "RunTask(a:build)", status: "timed-out" },
        { label: "RunTask(a:typecheck)", status: "passed" },
        { label: "RunTask(a:format)", status: "skipped" },
      ],
    });
    expect(failed.map((action) => (action as { label: string }).label)).toEqual([
      "RunTask(a:lint)",
      "RunTask(a:test)",
      "RunTask(a:build)",
    ]);
  });

  it("formats a plain-text failure block and GHA annotations", async () => {
    const { collectFailedActions, formatFailureReport, formatGithubAnnotations } =
      await loadModule();
    const failed = collectFailedActions(failedRunTaskReport());
    const report = formatFailureReport(failed);
    expect(report.names).toEqual(["server:format"]);
    expect(report.text).toContain("Failed moon tasks (1):");
    expect(report.text).toContain("- server:format (failed)");
    expect(report.text).toContain("error: Task process exited with a non-zero exit code");
    expect(formatGithubAnnotations(failed)).toEqual([
      "::error title=Moon task failed::server:format: Task process exited with a non-zero exit code",
    ]);
  });

  it("loads ciReport.json from a cache dir and writes a step summary", async () => {
    const { reportMoonFailures } = await loadModule();
    const root = await mkdtemp(join(tmpdir(), "moon-failures-"));
    const cacheDir = join(root, ".moon", "cache");
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, "ciReport.json"), JSON.stringify(failedRunTaskReport()));
    const summaryPath = join(root, "summary.md");

    const result = await reportMoonFailures({ cacheDir, summaryPath });
    expect(result).toEqual({
      failedCount: 1,
      skipped: false,
      path: join(cacheDir, "ciReport.json"),
    });

    const summary = await readFile(summaryPath, "utf8");
    expect(summary).toContain("## Failed Moon tasks");
    expect(summary).toContain("`server:format`");
  });

  it("no-ops cleanly when no report exists", async () => {
    const { loadMoonReport, reportMoonFailures } = await loadModule();
    const root = await mkdtemp(join(tmpdir(), "moon-failures-empty-"));
    const cacheDir = join(root, "cache");
    await mkdir(cacheDir, { recursive: true });

    expect(await loadMoonReport({ cacheDir })).toBeNull();
    expect(await reportMoonFailures({ cacheDir })).toEqual({
      failedCount: 0,
      skipped: true,
    });
  });
});
