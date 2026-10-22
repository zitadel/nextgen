import { describe, expect, it } from "vitest";

import { runSteps, type Step, type StepContext } from "../../../../src/lib/release/pipeline";
import type { SuggestedCommand } from "../../../../src/lib/suggestion";

function ctx(overrides: Partial<StepContext>): StepContext {
  return {
    cwd: "/tmp",
    client: {} as never,
    projectId: "proj_1",
    env: {},
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle: { schemas: [], flow_definitions: [], idps: [] },
    brandingSources: [],
    idpFiles: [],
    suggest: (args) => `${args} --env staging` as SuggestedCommand,
    ...overrides,
  };
}

function recordingStep(name: string, runs: string[], extra: Partial<Step> = {}): Step {
  return {
    name,
    runsFor: ["deploy", "preview"],
    run: async () => {
      runs.push(name);
    },
    ...extra,
  };
}

describe("runSteps", () => {
  it("runs the steps in order for the current mode", async () => {
    const runs: string[] = [];
    await runSteps([recordingStep("a", runs), recordingStep("b", runs)], ctx({}));

    expect(runs).toEqual(["a", "b"]);
  });

  it("skips a step that does not run for the mode", async () => {
    const runs: string[] = [];
    const deployOnly = recordingStep("deploy-only", runs, { runsFor: ["deploy"] });

    await runSteps([deployOnly], ctx({ mode: "preview" }));

    expect(runs).toEqual([]);
  });

  it("skips a writing step on a dry run but keeps the read-only ones", async () => {
    const runs: string[] = [];
    const writes = recordingStep("writes", runs, { writes: true });
    const reads = recordingStep("reads", runs);

    await runSteps([writes, reads], ctx({ dryRun: true }));

    expect(runs).toEqual(["reads"]);
  });
});
