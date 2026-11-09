import { describe, expect, it } from "vitest";

import { DeploymentService, SchemaService, UserService, VariableService } from "@/lib/backend";
import { runSteps, type Step, type StepContext } from "@/lib/publish/pipeline";
import type { SuggestedCommand } from "@/lib/suggestion";
import { MemoryStore, ZitadelConfig } from "@/lib/zitadel";
import { fakeClient } from "@tests/helpers/fake-client";

function ctx(overrides: Partial<StepContext>): StepContext {
  return {
    cwd: "/tmp",
    deployments: new DeploymentService(fakeClient({}), "proj_1"),
    variables: new VariableService(fakeClient({}), "proj_1"),
    schemas: new SchemaService(fakeClient({}), "proj_1"),
    users: new UserService(fakeClient({})),
    env: {},
    mode: "deploy",
    dryRun: false,
    json: true,
    color: false,
    bundle: { schemas: [], flow_definitions: [], idps: [], policies: [] },
    config: ZitadelConfig.empty(),
    store: new MemoryStore(),
    suggest: (args) => {
      return `${args} --env staging` as SuggestedCommand;
    },
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

  it("returns what the steps report, for the command's --json data", async () => {
    const runs: string[] = [];
    const diff = recordingStep("diff", runs, {
      run: async () => {
        return { data: { diff: { files: [] } } };
      },
    });
    const silent = recordingStep("silent", runs);

    const outcome = await runSteps([diff, silent], ctx({}));

    expect(outcome.data).toEqual({ diff: { files: [] } });
  });

  it("hands a later step what an earlier one learned", async () => {
    const runs: string[] = [];
    const seen: StepContext["learned"][] = [];
    const learns = recordingStep("diff", runs, {
      run: async () => {
        return { learned: { schemasOrFlowsChanged: false } };
      },
    });
    const reads = recordingStep("lockout", runs, {
      run: async (context) => {
        seen.push(context.learned);
        return undefined;
      },
    });

    await runSteps([learns, reads], ctx({ learned: {} }));

    expect(seen).toEqual([{ schemasOrFlowsChanged: false }]);
  });

  it("leaves out what a skipped step would have reported", async () => {
    const runs: string[] = [];
    const skipped = recordingStep("writes", runs, {
      writes: true,
      run: async () => {
        return { data: { release: "rel_1" } };
      },
    });

    const outcome = await runSteps([skipped], ctx({ dryRun: true }));

    expect(outcome.data).toEqual({});
  });
});
