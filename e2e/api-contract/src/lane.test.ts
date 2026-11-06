import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Credentials } from "./credentials";
import { Lane, type Runner } from "./lane";
import { SchemathesisReport } from "./report";
import type { SchemathesisInput } from "./schemathesis";
import { OpenApiSpec } from "./spec";

const spec = new OpenApiSpec({
  components: { securitySchemes: { oauth2: { type: "oauth2" } } },
  security: [{ oauth2: [] }],
  paths: {
    "/readyz": { get: { operationId: "ready", security: [] } },
    "/projects": { get: { operationId: "listProjects" } },
  },
});

const reportJson = JSON.stringify({
  operations: { selected: 1, tested: 1, skipped: 0, errored: 0 },
  warnings: { unmatched_filter: [] },
  complete: true,
  failures: [{ title: "Server error", count: 1, operations: ["GET /projects"] }],
  errors: [],
});

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "lane-test-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function lane(runner: Runner, credentials?: Partial<Credentials>): Lane {
  return new Lane({
    spec,
    specText: "{}",
    baseUrl: "http://x/api/v1",
    credentials: {
      forFamily: vi.fn().mockImplementation((family: string) => {
        return Promise.resolve({ headers: { Family: family }, schemes: {} });
      }),
      ...credentials,
    } as unknown as Credentials,
    runner,
    workDir: join(directory, "work"),
    artifactsDir: join(directory, "out"),
    log: () => undefined,
  });
}

function runner(): Runner & { inputs: SchemathesisInput[] } {
  const inputs: SchemathesisInput[] = [];
  return {
    inputs,
    run(input) {
      inputs.push(input);
      return Promise.resolve({
        exitCode: 1,
        log: "line",
        reportText: reportJson,
        report: SchemathesisReport.parse(reportJson),
      });
    },
  };
}

describe("Lane", () => {
  test("runs each family that has operations, with that family's credentials and operations", async () => {
    const fake = runner();

    const runs = await lane(fake).run();

    expect(runs.map((run) => run.family)).toEqual(["public", "management"]);
    expect(fake.inputs.map((input) => input.headers)).toEqual([
      { Family: "public" },
      { Family: "management" },
    ]);
    expect(fake.inputs.map((input) => input.operationIds)).toEqual([["ready"], ["listProjects"]]);
  });

  test("files the multi-step failures under the family that found them", async () => {
    const stateful = JSON.stringify({
      operations: { selected: 1, tested: 1, skipped: 0, errored: 0 },
      warnings: { unmatched_filter: [] },
      complete: true,
      failures: [{ title: "Use after free", count: 1, operations: ["Stateful tests"] }],
      errors: [],
    });
    const fake: Runner = {
      run() {
        return Promise.resolve({
          exitCode: 1,
          log: "",
          reportText: stateful,
          report: SchemathesisReport.parse(stateful),
        });
      },
    };

    const runs = await lane(fake).run();

    expect(runs.map((run) => run.failures[0]?.operation)).toEqual([
      "Stateful tests (public)",
      "Stateful tests (management)",
    ]);
  });

  test("gives each family a work folder of its own", async () => {
    const fake = runner();

    await lane(fake).run();

    expect(fake.inputs.map((input) => input.workDir)).toEqual([
      join(directory, "work", "public"),
      join(directory, "work", "management"),
    ]);
  });

  test("reports what each run found", async () => {
    const [first] = await lane(runner()).run();

    expect(first).toMatchObject({
      family: "public",
      operations: ["GET /readyz", "Stateful tests (public)"],
      exitCode: 1,
      expected: 1,
      accounting: { selected: 1, tested: 1, skipped: 0, errored: 0, unmatched: [] },
      complete: true,
      errors: [],
      failures: [{ operation: "GET /projects", check: "Server error", count: 1 }],
    });
  });

  test("keeps each family's report and output", async () => {
    await lane(runner()).run();

    expect(await readFile(join(directory, "out", "management", "report.json"), "utf8")).toBe(
      reportJson,
    );
    expect(await readFile(join(directory, "out", "management", "output.log"), "utf8")).toBe("line");
  });

  test("keeps only the end of a long output for the failure message", async () => {
    const long = Array.from({ length: 100 }, (_, index) => `line ${String(index)}`).join("\n");
    const fake: Runner = {
      run() {
        return Promise.resolve({
          exitCode: 0,
          log: long,
          reportText: reportJson,
          report: SchemathesisReport.parse(reportJson),
        });
      },
    };

    const [first] = await lane(fake).run();

    expect(first?.log.split("\n")).toHaveLength(30);
  });
});
