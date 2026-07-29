import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Failure = { name: string; status: string; error: string };

type ReportMoonFailuresModule = {
  actionName: (action: unknown) => string;
  normalizeFailures: (report: unknown) => Failure[];
  escapeAnnotation: (value: string) => string;
  escapeMarkdownTableCell: (value: string) => string;
  formatFailureReport: (failures: Failure[]) => string;
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

function failedRunTaskReport() {
  return {
    actions: [
      {
        label: "RunTask(server:format)",
        status: "failed",
        error: "Task process exited with a non-zero exit code",
        node: { action: "run-task", params: { target: "server:format" } },
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
      { name: "a:lint", status: "failed", error: "" },
      { name: "a:test", status: "invalid", error: "" },
      { name: "a:build", status: "timed-out", error: "" },
    ]);
  });

  it("formats a plain-text failure block and GHA annotations", async () => {
    const { normalizeFailures, formatFailureReport, formatGithubAnnotations } = await loadModule();
    const failures = normalizeFailures(failedRunTaskReport());
    const text = formatFailureReport(failures);
    expect(text).toContain("Failed moon tasks (1):");
    expect(text).toContain("- server:format (failed)");
    expect(text).toContain("error: Task process exited with a non-zero exit code");
    expect(formatGithubAnnotations(failures)).toEqual([
      "::error title=Moon task failed::server:format: Task process exited with a non-zero exit code",
    ]);
  });

  it("escapes workflow-command special characters in annotations", async () => {
    const { escapeAnnotation, formatGithubAnnotations } = await loadModule();
    expect(escapeAnnotation("100%\r\nok")).toBe("100%25%0D%0Aok");
    expect(
      formatGithubAnnotations([{ name: "a:test", status: "failed", error: "done 50%\nok" }]),
    ).toEqual(["::error title=Moon task failed::a:test: done 50%25%0Aok"]);
  });

  it("escapes markdown table cells and collapses newlines", async () => {
    const { escapeMarkdownTableCell, formatStepSummary } = await loadModule();
    expect(escapeMarkdownTableCell("a|b\\c")).toBe("a\\|b\\\\c");
    expect(escapeMarkdownTableCell("line1\nline2")).toBe("line1 / line2");
    const summary = formatStepSummary([
      { name: "server:format", status: "failed", error: "path\\with|pipe\nand more" },
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
