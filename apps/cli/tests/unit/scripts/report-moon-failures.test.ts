import { mkdtemp, mkdir, writeFile, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Failure = { name: string; status: string; detail: string };

type ReportMoonFailuresModule = {
  actionName: (action: unknown) => string;
  actionDetail: (action: unknown) => string;
  normalizeFailures: (report: unknown) => Failure[];
  escapeAnnotation: (value: string) => string;
  escapeMarkdownTableCell: (value: string) => string;
  formatGithubAnnotations: (failures: Failure[]) => string[];
  formatStepSummary: (failures: Failure[]) => string;
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

// Shaped after a real moon 2.x report: the action-level `error` is the same
// sentence for every failed task, and the exit code lives in the operations.
function failedRunTaskReport() {
  return {
    actions: [
      {
        label: "RunTask(server:format)",
        status: "failed",
        error: "Task server:format failed to run.",
        node: { action: "run-task", params: { target: "server:format" } },
        operations: [
          { meta: { type: "hash-generation", hash: "abc123" }, status: "passed" },
          { meta: { type: "task-execution", command: "gofmt -l", exitCode: 1 }, status: "failed" },
        ],
      },
      {
        label: "RunTask(server:test)",
        status: "skipped",
        error: null,
        node: { action: "run-task", params: { target: "server:test" } },
      },
      {
        label: "SetupToolchain",
        status: "passed",
        error: null,
        node: { action: "setup-toolchain", params: { toolchain: "go" } },
      },
    ],
  };
}

describe("report-moon-failures", () => {
  it("resolves run-task targets and falls back to labels", async () => {
    const { actionName } = await loadModule();
    expect(
      actionName({
        label: "RunTask(server:format)",
        node: { action: "run-task", params: { target: "server:format" } },
      }),
    ).toBe("server:format");
    expect(actionName({ label: "SetupToolchain" })).toBe("SetupToolchain");
  });

  it("prefers the task exit code over moon's boilerplate error", async () => {
    const { actionDetail } = await loadModule();
    expect(
      actionDetail({
        error: "Task server:format failed to run.",
        operations: [{ meta: { type: "task-execution", exitCode: 127 } }],
      }),
    ).toBe("exit 127");
    // Setup and sync actions run no task, so their error message is all there is.
    expect(actionDetail({ error: "  Failed to install go 1.24.  " })).toBe(
      "Failed to install go 1.24.",
    );
    expect(actionDetail({ operations: [{ meta: { type: "hash-generation" } }] })).toBe("");
  });

  it("normalizes failed, invalid, and timed-out actions only", async () => {
    const { normalizeFailures } = await loadModule();
    expect(
      normalizeFailures({
        actions: [
          { label: "RunTask(a:lint)", status: "failed", node: { action: "run-task", params: { target: "a:lint" } } },
          { label: "RunTask(a:test)", status: "invalid", node: { action: "run-task", params: { target: "a:test" } } },
          { label: "RunTask(a:build)", status: "timed-out", node: { action: "run-task", params: { target: "a:build" } } },
          { label: "RunTask(a:typecheck)", status: "passed", node: { action: "run-task", params: { target: "a:typecheck" } } },
          { label: "RunTask(a:format)", status: "skipped", node: { action: "run-task", params: { target: "a:format" } } },
        ],
      }),
    ).toEqual([
      { name: "a:lint", status: "failed", detail: "" },
      { name: "a:test", status: "invalid", detail: "" },
      { name: "a:build", status: "timed-out", detail: "" },
    ]);
  });

  it("annotates failures with the target, status, and exit code", async () => {
    const { normalizeFailures, formatGithubAnnotations } = await loadModule();
    expect(formatGithubAnnotations(normalizeFailures(failedRunTaskReport()))).toEqual([
      "::error title=Moon task failed::server:format failed (exit 1)",
    ]);
    expect(
      formatGithubAnnotations([{ name: "a:build", status: "timed-out", detail: "" }]),
    ).toEqual(["::error title=Moon task failed::a:build timed-out"]);
  });

  it("escapes workflow-command special characters in annotations", async () => {
    const { escapeAnnotation, formatGithubAnnotations } = await loadModule();
    expect(escapeAnnotation("100%\r\nok")).toBe("100%25%0D%0Aok");
    expect(
      formatGithubAnnotations([{ name: "a:test", status: "failed", detail: "done 50%\nok" }]),
    ).toEqual(["::error title=Moon task failed::a:test failed (done 50%25%0Aok)"]);
  });

  it("escapes markdown table cells and collapses newlines", async () => {
    const { escapeMarkdownTableCell, formatStepSummary } = await loadModule();
    expect(escapeMarkdownTableCell("a|b\\c")).toBe("a\\|b\\\\c");
    expect(escapeMarkdownTableCell("line1\nline2")).toBe("line1 / line2");
    const summary = formatStepSummary([
      { name: "server:format", status: "failed", detail: "path\\with|pipe\nand more" },
    ]);
    expect(summary).toContain("path\\\\with\\|pipe / and more");
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
    expect(summary).toContain("| `server:format` | failed | exit 1 |");
  });

  // A job that runs `moon ci` and then `moon run` leaves both reports behind;
  // reading the stale one reports the wrong step's failures.
  it("reads the newest report when both exist", async () => {
    const { loadMoonReport } = await loadModule();
    const cacheDir = await mkdtemp(join(tmpdir(), "moon-failures-newest-"));
    await writeFile(join(cacheDir, "ciReport.json"), JSON.stringify({ actions: [] }));
    await writeFile(join(cacheDir, "runReport.json"), JSON.stringify(failedRunTaskReport()));

    const stale = new Date(Date.now() - 60_000);
    await utimes(join(cacheDir, "ciReport.json"), stale, stale);

    const loaded = await loadMoonReport({ cacheDir });
    expect(loaded?.path).toBe(join(cacheDir, "runReport.json"));
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
