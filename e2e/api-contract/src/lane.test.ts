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

  test("tells each run which operations to exempt from which check", async () => {
    const fake = runner();

    await lane(fake).run();

    expect(fake.inputs.map((input) => input.exemptions)).toEqual([[], []]);
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

  describe("a family big enough to split", () => {
    const paths: Record<string, Record<string, unknown>> = {};
    for (let index = 0; index < 32; index += 1) {
      paths[`/things/${String(index)}`] = { get: { operationId: `get${String(index)}` } };
    }
    const big = new OpenApiSpec({
      components: { securitySchemes: { oauth2: { type: "oauth2" } } },
      security: [{ oauth2: [] }],
      paths,
    });

    function bigLane(runner: Runner): Lane {
      return new Lane({
        spec: big,
        specText: "{}",
        baseUrl: "http://x/api/v1",
        credentials: {
          forFamily: () => Promise.resolve({ headers: {}, schemes: {} }),
        } as unknown as Credentials,
        runner,
        workDir: join(directory, "work"),
        artifactsDir: join(directory, "out"),
        log: () => undefined,
      });
    }

    function slicedReport(tested: number): string {
      return JSON.stringify({
        operations: { selected: tested, tested, skipped: 0, errored: 0 },
        warnings: { unmatched_filter: [] },
        complete: true,
        failures: [{ title: "Server error", count: 2, operations: ["GET /things/0"] }],
        errors: [],
      });
    }

    test("deals every operation into exactly one slice", () => {
      const ids = Array.from({ length: 32 }, (_, index) => `get${String(index)}`);

      const slices = Lane.slices(ids);

      expect(slices.flat().sort()).toEqual([...ids].sort());
      expect(new Set(slices.flat()).size).toBe(ids.length);
      expect(Lane.slices(["a", "b"])).toEqual([["a", "b"]]);
    });

    test("runs the slices without the multi-step phase and the multi-step phase on every operation", async () => {
      const fake = runner();

      await bigLane(fake).run();

      const stateful = fake.inputs.filter((input) => {
        return input.phases?.join() === "stateful";
      });
      const sliced = fake.inputs.filter((input) => {
        return input.phases?.join() === "examples,coverage,fuzzing";
      });
      expect(stateful).toHaveLength(1);
      expect(stateful[0]?.operationIds).toHaveLength(32);
      expect(sliced.length).toBeGreaterThan(1);
      expect(
        sliced
          .flatMap((input) => {
            return [...input.operationIds];
          })
          .sort(),
      ).toEqual(
        Array.from({ length: 32 }, (_, index) => {
          return `get${String(index)}`;
        }).sort(),
      );
    });

    test("counts only the slices as tested, and adds up the failures", async () => {
      const fake: Runner = {
        run(input) {
          const text = slicedReport(
            input.phases?.join() === "stateful" ? 32 : input.operationIds.length,
          );
          return Promise.resolve({
            exitCode: 1,
            log: "",
            reportText: text,
            report: SchemathesisReport.parse(text),
          });
        },
      };

      const [run] = await bigLane(fake).run();

      expect(run?.accounting).toMatchObject({ selected: 32, tested: 32 });
      expect(run?.failures).toEqual([
        { operation: "GET /things/0", check: "Server error", count: 2 * 5 },
      ]);
    });
  });

  test("waits for every run before it throws, so none outlives the caller", async () => {
    let finished = false;
    const fake: Runner = {
      run(input) {
        if (input.headers.Family === "public") {
          return Promise.reject(new Error("container did not start"));
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            finished = true;
            resolve({
              exitCode: 0,
              log: "",
              reportText: reportJson,
              report: SchemathesisReport.parse(reportJson),
            });
          }, 20);
        });
      },
    };

    await expect(lane(fake).run()).rejects.toThrow("container did not start");
    expect(finished).toBe(true);
  });

  test("mints credentials one family at a time", async () => {
    let active = 0;
    let most = 0;
    const credentials = {
      forFamily: async () => {
        active += 1;
        most = Math.max(most, active);
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        active -= 1;
        return { headers: {}, schemes: {} };
      },
    } as unknown as Credentials;

    await lane(runner(), credentials).run();

    expect(most).toBe(1);
  });
});
