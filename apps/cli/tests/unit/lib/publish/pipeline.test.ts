import { describe, expect, it } from "vitest";

import { runSteps, type Step, type StepContext, type StepResult } from "@/lib/publish/pipeline";
import { aStepContext } from "@tests/helpers/step-context";

/**
 * A step that records its name in `runs` when it runs, and reports `result`.
 *
 * @param name - The step's name.
 * @param runs - Where the names of the steps that ran are kept, in order.
 * @param overrides - What the step differs in: the modes it runs for, whether it writes.
 * @param result - What the step reports.
 * @returns The step.
 */
function aStep(
  name: string,
  runs: string[],
  overrides: Partial<Pick<Step, "runsFor" | "writes">> = {},
  result?: StepResult,
): Step {
  return {
    name,
    runsFor: ["deploy", "preview"],
    run: async () => {
      runs.push(name);
      return result;
    },
    ...overrides,
  };
}

describe("runSteps", () => {
  it("runs the steps in order for the current mode", async () => {
    const runs: string[] = [];

    await runSteps([aStep("a", runs), aStep("b", runs)], aStepContext());

    expect(runs).toEqual(["a", "b"]);
  });

  it("returns what the steps report, for the command's --json data", async () => {
    const runs: string[] = [];
    const diff = aStep("diff", runs, {}, { data: { diff: { files: [] } } });
    const silent = aStep("silent", runs);

    const outcome = await runSteps([diff, silent], aStepContext());

    expect(outcome.data).toEqual({ diff: { files: [] } });
  });

  it("returns the lockouts every step found, in order", async () => {
    const runs: string[] = [];
    const first = aStep("first", runs, {}, { lockouts: ["a"] });
    const second = aStep("second", runs, {}, { lockouts: ["b"] });

    const outcome = await runSteps([first, aStep("silent", runs), second], aStepContext());

    expect(outcome.lockouts).toEqual(["a", "b"]);
  });

  it("hands a later step what an earlier one learned", async () => {
    const runs: string[] = [];
    const learns = aStep("diff", runs, {}, { learned: { schemasOrFlowsChanged: false } });
    const seen: StepContext["learned"][] = [];
    const reads: Step = {
      name: "lockout",
      runsFor: ["deploy"],
      run: async (context) => {
        seen.push(context.learned);
        return undefined;
      },
    };

    await runSteps([learns, reads], aStepContext({ learned: {} }));

    expect(seen).toEqual([{ schemasOrFlowsChanged: false }]);
  });

  describe("when the mode is one a step does not run for", () => {
    it("skips the step", async () => {
      const runs: string[] = [];
      const deployOnly = aStep("deploy-only", runs, { runsFor: ["deploy"] });

      await runSteps([deployOnly], aStepContext({ mode: "preview" }));

      expect(runs).toEqual([]);
    });
  });

  describe("with a dry run", () => {
    it("skips a writing step but keeps the read-only ones", async () => {
      const runs: string[] = [];
      const writes = aStep("writes", runs, { writes: true });
      const reads = aStep("reads", runs);

      await runSteps([writes, reads], aStepContext({ dryRun: true }));

      expect(runs).toEqual(["reads"]);
    });

    it("leaves out what a skipped step would have reported", async () => {
      const runs: string[] = [];
      const skipped = aStep("writes", runs, { writes: true }, { data: { release: "rel_1" } });

      const outcome = await runSteps([skipped], aStepContext({ dryRun: true }));

      expect(outcome.data).toEqual({});
    });
  });
});
