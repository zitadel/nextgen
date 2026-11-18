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

/** Hands out a new session each time, as the real credentials do. */
function credentials(): CredentialSource {
  return {
    bearer: () => {
      return { oauth2: { kind: "bearer", value: "secret" } };
    },
    session: () => {
      minted += 1;
      return Promise.resolve({
        scheme: { sessionCookie: { kind: "cookie", value: `cookie-${String(minted)}` } },
        csrfToken: `csrf-${String(minted)}`,
      });
    },
  };
}

function contract(runner: Runner): Contract {
  return new Contract({
    spec,
    baseUrl: "http://x/api/v1",
    credentials: credentials(),
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
  test("runs two commands: every operation but the logout, then the logout alone", async () => {
    const fake = runner();

    const runs = await contract(fake).run();

    expect(runs.map((run) => run.name)).toEqual(["all", "logout"]);
    expect(fake.inputs.map((input) => input.operationIds)).toEqual([
      ["listProjects", "ready", "getMySession"],
      ["endMySession"],
    ]);
  });

  test("gives the main command both credentials and the logout command a session of its own", async () => {
    const fake = runner();

    await contract(fake).run();

    expect(fake.inputs.map((input) => input.schemes)).toEqual([
      {
        oauth2: { kind: "bearer", value: "secret" },
        sessionCookie: { kind: "cookie", value: "cookie-1" },
      },
      { sessionCookie: { kind: "cookie", value: "cookie-2" } },
    ]);
  });

  test("sends the CSRF token only with the cookie operations", async () => {
    const fake = runner();

    await contract(fake).run();

    expect(fake.inputs.map((input) => input.operationHeaders)).toEqual([
      { getMySession: { "X-Zitadel-CSRF": "csrf-1" } },
      { endMySession: { "X-Zitadel-CSRF": "csrf-2" } },
    ]);
  });

  test("runs the logout without the multi-step phase", async () => {
    const fake = runner();

    await contract(fake).run();

    expect(fake.inputs.map((input) => input.phases)).toEqual([
      undefined,
      ["examples", "coverage", "fuzzing"],
    ]);
  });

  test("reports what each command found, with the multi-step test after the operations", async () => {
    const [first] = await contract(runner()).run();

    expect(first).toMatchObject({
      name: "all",
      operations: ["GET /projects", "GET /readyz", "GET /sessions/me", "Stateful tests"],
      exitCode: 1,
      expected: 3,
      complete: true,
      errors: [],
      failures: [{ operation: "GET /projects", check: "Server error", count: 1 }],
    });
  });

  test("keeps each command's report and output", async () => {
    await contract(runner()).run();

    expect(await readFile(join(directory, "out", "all", "report.json"), "utf8")).toBe(reportJson);
    expect(await readFile(join(directory, "out", "all", "output.log"), "utf8")).toBe("line");
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

    const [first] = await contract(fake).run();

    expect(first?.log.split("\n")).toHaveLength(30);
  });

  test("waits for both commands before it throws one's failure", async () => {
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

    await expect(contract(fake).run()).rejects.toThrow("boom");
    expect(finished).toBe(true);
  });
});
