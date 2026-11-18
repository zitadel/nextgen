import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { CommandInput } from "./command";
import { Contract, type CredentialSource, type Runner } from "./contract";
import { SchemathesisReport } from "./report";
import { OpenApiSpec } from "./spec";

const spec = new OpenApiSpec({
  components: {
    securitySchemes: {
      oauth2: { type: "oauth2" },
      sessionCookie: { type: "apiKey", in: "cookie" },
    },
  },
  security: [{ oauth2: [] }],
  paths: {
    "/readyz": { get: { operationId: "ready", security: [] } },
    "/projects": { get: { operationId: "listProjects" } },
    "/sessions/me": {
      get: { operationId: "getMySession", security: [{ sessionCookie: [] }] },
      delete: { operationId: "endMySession", security: [{ sessionCookie: [] }] },
    },
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
let minted = 0;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "contract-test-"));
  minted = 0;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** Makes a project of its own each time, as the instance does: its own secret and its own session. */
function project(): Promise<CredentialSource> {
  minted += 1;
  const own = minted;
  return Promise.resolve({
    bearer: () => {
      return { oauth2: { kind: "bearer", value: `secret-${String(own)}` } };
    },
    session: () => {
      return Promise.resolve({
        scheme: { sessionCookie: { kind: "cookie", value: `cookie-${String(own)}` } },
        csrfToken: `csrf-${String(own)}`,
      });
    },
  });
}

function contract(runner: Runner, shards = 2): Contract {
  return new Contract({
    spec,
    baseUrl: "http://x/api/v1",
    project,
    shards,
    runner,
    artifactsDir: join(directory, "out"),
    log: () => undefined,
  });
}

function runner(): Runner & { inputs: CommandInput[] } {
  const inputs: CommandInput[] = [];
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

describe("Contract", () => {
  test("runs the shards, the multi-step phase and the logout as commands of their own", async () => {
    const fake = runner();

    const runs = await contract(fake, 1).run();

    expect(runs.map((run) => run.name)).toEqual(["shard-0", "stateful", "logout"]);
    expect(fake.inputs.map((input) => input.operationIds)).toEqual([
      ["listProjects", "ready", "getMySession"],
      ["listProjects", "ready", "getMySession"],
      ["endMySession"],
    ]);
  });

  test("deals every operation but the logout into exactly one shard", async () => {
    const fake = runner();

    await contract(fake, 2).run();

    const dealt = fake.inputs
      .filter((input) => {
        return input.name.startsWith("shard-");
      })
      .flatMap((input) => {
        return input.operationIds;
      });
    expect([...dealt].sort()).toEqual(["getMySession", "listProjects", "ready"]);
  });

  test("gives every command a project of its own", async () => {
    const fake = runner();

    await contract(fake, 1).run();

    const secrets = fake.inputs.map((input) => {
      return Object.values(input.schemes).find((scheme) => {
        return scheme.kind === "bearer";
      })?.value;
    });
    expect(new Set(secrets).size).toBe(fake.inputs.length);
  });

  test("runs the shards through the per-operation phases and the multi-step run through its own", async () => {
    const fake = runner();

    await contract(fake, 1).run();

    expect(fake.inputs.map((input) => input.phases)).toEqual([
      ["examples", "coverage", "fuzzing"],
      ["stateful"],
      ["examples", "coverage", "fuzzing"],
    ]);
  });

  test("sends the CSRF token only with the cookie operations", async () => {
    const fake = runner();

    await contract(fake, 1).run();

    expect(fake.inputs.map((input) => input.operationHeaders)).toEqual([
      { getMySession: { "X-Zitadel-CSRF": "csrf-1" } },
      { getMySession: { "X-Zitadel-CSRF": "csrf-2" } },
      { endMySession: { "X-Zitadel-CSRF": "csrf-3" } },
    ]);
  });

  test("counts the shards and the logout, and not the multi-step run that repeats them", async () => {
    const runs = await contract(runner(), 1).run();

    expect(runs.map((run) => run.counted)).toEqual([true, false, true]);
    expect(runs[1]?.operations).toEqual(["Stateful tests"]);
  });

  test("reports what a command found", async () => {
    const [first] = await contract(runner(), 1).run();

    expect(first).toMatchObject({
      name: "shard-0",
      operations: ["GET /projects", "GET /readyz", "GET /sessions/me"],
      exitCode: 1,
      expected: 3,
      complete: true,
      errors: [],
      failures: [{ operation: "GET /projects", check: "Server error", count: 1 }],
    });
  });

  test("keeps each command's report and output", async () => {
    await contract(runner(), 1).run();

    expect(await readFile(join(directory, "out", "shard-0", "report.json"), "utf8")).toBe(
      reportJson,
    );
    expect(await readFile(join(directory, "out", "shard-0", "output.log"), "utf8")).toBe("line");
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

    const [first] = await contract(fake, 1).run();

    expect(first?.log.split("\n")).toHaveLength(30);
  });

  test("waits for every command before it throws one's failure", async () => {
    let finished = false;
    const fake: Runner = {
      run(input) {
        if (input.name === "logout") {
          return Promise.reject(new Error("boom"));
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

    await expect(contract(fake, 1).run()).rejects.toThrow("boom");
    expect(finished).toBe(true);
  });
});
