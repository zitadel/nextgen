import { describe, expect, it } from "vitest";

import { Check, type CheckResult, type Outcome, runChecks } from "../../../../src/lib/checks/check";

class Fixed extends Check<null> {
  readonly name: string;
  readonly outcome: Outcome | Error;
  override readonly dependsOn: readonly string[];

  constructor(name: string, outcome: Outcome | Error, dependsOn: readonly string[] = []) {
    super();
    this.name = name;
    this.outcome = outcome;
    this.dependsOn = dependsOn;
  }

  get title(): string {
    return this.name.toUpperCase();
  }

  async run(): Promise<Outcome> {
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

const pass: Outcome = { status: "pass", message: "ok" };

describe("runChecks", () => {
  it("runs the checks in order and reports each as it finishes", async () => {
    const seen: string[] = [];

    const results = await runChecks([new Fixed("a", pass), new Fixed("b", pass)], null, (result) =>
      seen.push(result.name),
    );

    expect(seen).toEqual(["a", "b"]);
    expect(results.map((result) => result.name)).toEqual(["a", "b"]);
  });

  it("carries a check's name and title into its result", async () => {
    const [result] = await runChecks([new Fixed("a", pass)], null);

    expect(result).toEqual({ name: "a", title: "A", status: "pass", message: "ok" });
  });

  it("fails a check that throws, with the error's message", async () => {
    const [result] = await runChecks([new Fixed("a", new Error("boom"))], null);

    expect(result).toMatchObject({ status: "fail", message: "boom" });
  });

  it.each(["fail", "skipped"] as const)("skips a check whose dependency was %s", async (status) => {
    const results = await runChecks(
      [new Fixed("a", { status, message: "no" }), new Fixed("b", pass, ["a"])],
      null,
    );

    expect(results[1]).toMatchObject({ status: "skipped", message: 'Needs "A" first' });
  });

  it.each(["pass", "warn"] as const)(
    "runs a check whose dependency ended in %s",
    async (status) => {
      const results: readonly CheckResult[] = await runChecks(
        [new Fixed("a", { status, message: "fine" }), new Fixed("b", pass, ["a"])],
        null,
      );

      expect(results[1]?.status).toBe("pass");
    },
  );

  it("skips a check that depends on one that never ran", async () => {
    const [result] = await runChecks([new Fixed("b", pass, ["missing"])], null);

    expect(result).toMatchObject({ status: "skipped", message: 'Needs "missing" first' });
  });
});
