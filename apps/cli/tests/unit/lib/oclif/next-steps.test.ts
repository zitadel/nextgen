import { describe, expect, it } from "vitest";

import { nextStepsData, renderNextSteps } from "../../../../src/lib/oclif/next-steps";

describe("nextStepsData", () => {
  it("writes both lists under the envelope keys", () => {
    expect(nextStepsData({ actions: ["Read it."], commands: ["zitadel deploy"] })).toEqual({
      next_actions: ["Read it."],
      next_commands: ["zitadel deploy"],
    });
  });

  it("emits a list the command set empty", () => {
    expect(nextStepsData({ commands: [] })).toEqual({ next_commands: [] });
  });

  it("leaves out a list the command did not set", () => {
    expect(nextStepsData({ commands: ["zitadel deploy"] })).not.toHaveProperty("next_actions");
  });
});

describe("renderNextSteps", () => {
  it("lists the prose, then each command on a $ line", () => {
    expect(renderNextSteps({ actions: ["Read it."], commands: ["zitadel deploy"] })).toBe(
      "Next:\n  Read it.\n  $ zitadel deploy",
    );
  });

  it("renders nothing when there is nothing to do next", () => {
    expect(renderNextSteps({ actions: [], commands: [] })).toBe("");
  });
});
