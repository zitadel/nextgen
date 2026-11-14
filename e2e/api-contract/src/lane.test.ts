import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Lane, type Instance, type Instances, type Runner } from "./lane";
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

/** Hands out a new instance on each call, and remembers which are still running. */
function instances(): Instances & { started: Instance[]; running: Set<Instance> } {
  const started: Instance[] = [];
  const running = new Set<Instance>();
  return {
    started,
    running,
    start() {
      const instance: Instance = {
        baseUrl: `http://instance-${String(started.length)}/api/v1`,
        credentialFor: (family) => {
          return Promise.resolve({ headers: { Family: family }, schemes: {} });
        },
        stop: () => {
          running.delete(instance);
          return Promise.resolve();
        },
      };
      started.push(instance);
      running.add(instance);
      return Promise.resolve(instance);
    },
  };
}

function lane(runner: Runner, provider: Instances = instances()): Lane {
  return new Lane({
    spec,
    specText: "{}",
    instances: provider,
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

  test("gives each operation a work folder of its own", async () => {
    const fake = runner();

    await lane(fake).run();

    expect(fake.inputs.map((input) => input.workDir)).toEqual([
      join(directory, "work", "public", "ready"),
      join(directory, "work", "management", "listProjects"),
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

  test("keeps each container's report and output", async () => {
    await lane(runner()).run();

    expect(
      await readFile(join(directory, "out", "management", "listProjects", "report.json"), "utf8"),
    ).toBe(reportJson);
    expect(
      await readFile(join(directory, "out", "management", "listProjects", "output.log"), "utf8"),
    ).toBe("line");
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

  describe("a family of many operations", () => {
    function specOf(count: number, prefix = "get"): OpenApiSpec {
      const paths: Record<string, Record<string, unknown>> = {};
      for (let index = 0; index < count; index += 1) {
        paths[`/${prefix}/${String(index)}`] = {
          get: { operationId: `${prefix}${String(index)}` },
        };
      }
      return new OpenApiSpec({
        components: { securitySchemes: { oauth2: { type: "oauth2" } } },
        security: [{ oauth2: [] }],
        paths,
      });
    }

    function laneOf(spec: OpenApiSpec, runner: Runner): Lane {
      return new Lane({
        spec,
        specText: "{}",
        instances: instances(),
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
        failures: [{ title: "Server error", count: 2, operations: ["GET /get/0"] }],
        errors: [],
      });
    }

    test("runs every operation alone, without the multi-step phase", async () => {
      const fake = runner();

      await laneOf(specOf(32), fake).run();

      const alone = fake.inputs.filter((input) => {
        return input.phases?.join() === "examples,coverage,fuzzing";
      });
      expect(alone).toHaveLength(32);
      expect(
        alone
          .map((input) => {
            return input.operationIds.join();
          })
          .sort(),
      ).toEqual(
        Array.from({ length: 32 }, (_, index) => {
          return `get${String(index)}`;
        }).sort(),
      );
    });

    test("runs the multi-step phase once, on every operation", async () => {
      const fake = runner();

      await laneOf(specOf(32), fake).run();

      const stateful = fake.inputs.filter((input) => {
        return input.phases?.join() === "stateful";
      });
      expect(stateful).toHaveLength(1);
      expect(stateful[0]?.operationIds).toHaveLength(32);
    });

    test("leaves an operation's run the same whatever else is in the family", async () => {
      const before = runner();
      const after = runner();

      await laneOf(specOf(5), before).run();
      await laneOf(specOf(9), after).run();

      const alone = (fake: ReturnType<typeof runner>): unknown => {
        return fake.inputs.find((input) => {
          return input.operationIds.join() === "get3" && input.phases?.length === 3;
        });
      };
      expect(alone(after)).toEqual({ ...(alone(before) as object), baseUrl: expect.any(String) });
      expect(alone(before)).toBeDefined();
    });

    test("counts every operation once, and adds up the failures of every container", async () => {
      let containers = 0;
      const fake: Runner = {
        run(input) {
          containers += 1;
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

      const [run] = await laneOf(specOf(32), fake).run();

      expect(run?.accounting).toMatchObject({ selected: 32, tested: 32 });
      expect(run?.failures).toEqual([
        { operation: "GET /get/0", check: "Server error", count: 2 * containers },
      ]);
      expect(containers).toBe(33);
    });

    test("names a folder after the operation, with nothing a path could misread", () => {
      expect(Lane.folderName("listProjects")).toBe("listProjects");
      expect(Lane.folderName("a/b c:d")).toBe("a_b_c_d");
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

  test("runs every container on an instance of its own and stops each one", async () => {
    const provider = instances();
    const fake = runner();

    await lane(fake, provider).run();

    expect(new Set(fake.inputs.map((input) => input.baseUrl)).size).toBe(fake.inputs.length);
    expect(provider.started).toHaveLength(fake.inputs.length);
    expect(provider.running.size).toBe(0);
  });

  test("gives every container an instance of its own, however many there are", async () => {
    const provider = instances();
    const fake = runner();

    await new Lane({
      spec,
      specText: "{}",
      instances: provider,
      runner: fake,
      workDir: join(directory, "work"),
      artifactsDir: join(directory, "out"),
      log: () => undefined,
    }).run();

    expect(provider.started).toHaveLength(fake.inputs.length);
  });

  test("stops an instance whose run failed", async () => {
    const provider = instances();
    const fake: Runner = {
      run() {
        return Promise.reject(new Error("container did not start"));
      },
    };

    await expect(lane(fake, provider).run()).rejects.toThrow("container did not start");
    expect(provider.running.size).toBe(0);
  });
});
