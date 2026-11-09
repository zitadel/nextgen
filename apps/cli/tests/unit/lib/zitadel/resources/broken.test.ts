import { describe, expect, it } from "vitest";

import { BrokenFile } from "@/lib/zitadel/resources/broken";

/**
 * Where the broken file in these tests sits.
 */
const PATH = ".zitadel/schemas/broken.json";

describe("BrokenFile.problems", () => {
  it("names the file once for every finding, with its message", () => {
    const broken = new BrokenFile({
      path: PATH,
      kind: "schema",
      body: {},
      issues: [
        { severity: "error", rule: "contract/schema", file: PATH, message: "kind is required" },
        { severity: "error", rule: "contract/schema", file: PATH, message: "type is required" },
      ],
    });

    const problems = broken.problems;

    expect(problems).toEqual([
      { path: PATH, problem: "kind is required" },
      { path: PATH, problem: "type is required" },
    ]);
  });
});
