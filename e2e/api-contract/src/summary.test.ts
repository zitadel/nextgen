import { describe, expect, test } from "vitest";

import type { Baseline } from "./baseline";
import type { CommandRun } from "./contract";
import { ContractSummary } from "./summary";

function run(failures: CommandRun["failures"]): CommandRun {
  return {
    name: "all",
    counted: true,
    operations: ["GET /teams", "Stateful tests"],
    expected: 1,
    accounting: { selected: 1, tested: 1, skipped: 0, errored: 0, unmatched: [] },
    exitCode: 1,
    log: "",
    complete: true,
    stopReason: "",
    errors: [],
    failures,
    details: {},
    seconds: 1,
  };
}

const baseline = {
  verdict: (operation: string, failures: { check: string }[]) => {
    return operation === "GET /teams" && failures.length > 0
      ? [`New failure: "${failures[0]?.check ?? ""}" (3 requests).`]
      : [];
  },
} as unknown as Baseline;

const failing = [{ operation: "GET /teams", check: "Server error", count: 3 }];

const detail = {
  id: "abc123",
  checks: ["Server error"],
  response: '[500] Internal Server Error\n{"code":"internal"}',
  curl: "curl -X GET http://x/api/v1/teams",
};

function withDetails(): CommandRun {
  return { ...run(failing), details: { "GET /teams": [detail] } };
}

describe("ContractSummary", () => {
  test("says so when nothing broke", () => {
    expect(new ContractSummary([run([])], baseline).markdown()).toContain("API contract: passed");
    expect(new ContractSummary([run([])], baseline).text()).toContain("API contract: passed");
  });

  test("names the operation, the check and how to reproduce", () => {
    const page = new ContractSummary([run(failing)], baseline).markdown();

    expect(page).toContain("`GET /teams`");
    expect(page).toContain('New failure: "Server error"');
    expect(page).toContain("turbo run api-contract --filter=@zitadel/e2e");
  });

  test("shows the response and the request that broke the operation, and how to replay it", () => {
    const page = new ContractSummary([withDetails()], baseline).markdown();

    expect(page).toContain('[500] Internal Server Error\n{"code":"internal"}');
    expect(page).toContain("curl -X GET http://x/api/v1/teams");
    expect(page).toContain("st replay abc123");
  });

  test("shows no more than two failing requests for one operation", () => {
    const many = { ...run(failing), details: { "GET /teams": [detail, detail, detail] } };

    expect(new ContractSummary([many], baseline).markdown().split("st replay").length - 1).toBe(2);
  });

  test("writes the verdict for a log without any Markdown", () => {
    const text = new ContractSummary([withDetails()], baseline).text();

    expect(text).toContain("API contract: broken. 1 of 1 operations do not match the spec.");
    expect(text).toContain('  New failure: "Server error" (3 requests).');
    expect(text).toContain("    curl -X GET http://x/api/v1/teams");
    expect(text).not.toMatch(/^#|```/m);
  });

  test("annotates each problem with its failing request, for the check page", () => {
    const annotations = new ContractSummary([withDetails()], baseline).annotations();

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain("::error title=API contract%3A GET /teams::");
    expect(annotations[0]).toContain("curl -X GET http://x/api/v1/teams");
    expect(annotations[0]).not.toContain("\n");
  });

  test("points an annotation at the operation's definition when it is known", () => {
    const annotations = new ContractSummary([run(failing)], baseline).annotations(() => {
      return { file: "apps/api/api/openapi/endpoints/teams/methods.yaml", line: 12 };
    });

    expect(annotations[0]).toMatch(
      /^::error file=apps\/api\/api\/openapi\/endpoints\/teams\/methods.yaml,line=12,title=API contract%3A GET \/teams::/,
    );
  });

  test("tells how long each command took, and copes with no commands", () => {
    const page = new ContractSummary([run([])], baseline).markdown();

    expect(page).toContain("| all | 1 | 1s |");
    expect(page).toContain(
      "| all of them (they run at the same time, so this is the slowest) | | 1s |",
    );
    expect(new ContractSummary([], baseline).timing()).toContain("| | 0s |");
  });

  test("does not count the multi-step run's operations again", () => {
    const stateful = { ...run([]), name: "stateful", counted: false, expected: 106 };

    expect(new ContractSummary([stateful], baseline).timing()).toContain(
      "| stateful | multi-step phase | 1s |",
    );
  });

  test("escapes the title and message of an annotation", () => {
    const summary = new ContractSummary([run(failing)], {
      verdict: () => {
        return ["50%, done\r\nnext"];
      },
    } as unknown as Baseline);

    expect(summary.annotations()[0]).toBe(
      "::error title=API contract%3A GET /teams::50%25, done%0D%0Anext",
    );
  });
});
