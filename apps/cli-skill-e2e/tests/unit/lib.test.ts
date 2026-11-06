import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Stage } from "../support/journey";
import { evalAssertion, gradeConfig, gradeStage } from "../support/lib";

const dirs: string[] = [];

function resultsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "zitadel-skill-eval-unit-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function parsedAnswer(final: string) {
  return {
    pairs: [{ cmd: "cat .env.local", out: "ZITADEL_PROJECT_SECRET client_id" }],
    final,
    result: { is_error: false },
  };
}

describe("evalAssertion", () => {
  it.each([
    ["exists", { op: "exists", path: "a.b" }, { a: { b: 1 } }, true],
    ["exists on a missing value", { op: "exists", path: "a.c" }, { a: { b: 1 } }, false],
    ["eq", { op: "eq", path: "a", value: true }, { a: true }, true],
    ["neq", { op: "neq", path: "a", value: true }, { a: false }, true],
    ["count-eq", { op: "count-eq", path: "items", value: 1 }, { items: [1] }, true],
    ["count-gte", { op: "count-gte", path: "items", value: 2 }, { items: [1] }, false],
    [
      "the first of several paths that resolves",
      { op: "exists", path: ["x", "y"] },
      { y: 1 },
      true,
    ],
    [
      "a value inside the data envelope",
      { op: "eq", path: "a", value: 2 },
      { data: { a: 2 } },
      true,
    ],
  ])("%s", (_name, assertion, response, expected) => {
    expect(evalAssertion(response, assertion as never).passed).toBe(expected);
  });
});

describe("gradeStage for the credentials question", () => {
  const stage = { id: 3, grade: "inspect-credentials" } as Stage;

  it("passes an answer that says there is no OAuth client and names the project id and secret", () => {
    const answer =
      "**No.** The project has no OAuth client ID. It has a project ID and a project secret.";

    expect(gradeStage(stage, resultsDir(), parsedAnswer(answer), true).status).toBe("pass");
  });

  it("fails an answer that mistakes the project secret for an OAuth client", () => {
    const answer = "**Yes.** It has a client id and secret in .env.local (ZITADEL_PROJECT_SECRET).";

    expect(gradeStage(stage, resultsDir(), parsedAnswer(answer), true).status).toBe("fail");
  });

  it("fails a bare no that does not name what the project does have", () => {
    expect(gradeStage(stage, resultsDir(), parsedAnswer("No."), true).status).toBe("fail");
  });
});

describe("gradeConfig", () => {
  const stages = [
    {
      id: 1,
      title: "set up",
      grade: "setup",
      prompt: "",
      assert: [{ name: "a project exists", get: "projects list", path: "items", op: "count-gte" }],
      app: "register-signin",
    },
    {
      id: 2,
      title: "list",
      grade: "list",
      prompt: "",
      assert: [{ name: "one project", get: "projects list", path: "items", op: "count-eq" }],
    },
  ] as Stage[];

  function writeResults(dir: string, files: Record<string, unknown>): void {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(dir, name),
        typeof content === "string" ? content : JSON.stringify(content),
      );
    }
  }

  it("marks a stage that was not selected as skipped, not failed", () => {
    const dir = resultsDir();
    writeResults(dir, { "stages-run.json": [1] });

    const rows = gradeConfig(dir, stages);

    expect(rows.find((row) => row.stage === 2)?.status).toBe("skipped");
  });

  it("does not block later stages when stage 1 built the project but an in-app check failed", () => {
    const dir = resultsDir();
    writeResults(dir, {
      "stage1.jsonl": `${JSON.stringify({ type: "result", is_error: false, num_turns: 1 })}\n`,
      "stage2.jsonl": `${JSON.stringify({ type: "result", is_error: false, num_turns: 1 })}\n`,
      "asserts-stage1.json": {
        results: [
          { name: "a project exists", passed: true, evidence: "" },
          { name: "a new user can register in the app", passed: false, evidence: "" },
        ],
      },
      "asserts-stage2.json": { results: [{ name: "one project", passed: true, evidence: "" }] },
    });
    mkdirSync(join(dir, "artifacts"));

    const rows = gradeConfig(dir, stages);

    expect(rows.map((row) => row.status)).toEqual(["fail", "pass"]);
  });
});
