import { describe, expect, it } from "vitest";

import { WizardStep } from "@/lib/wizard";

/**
 * A step that leaves {@link WizardStep.undo} as it is.
 */
class Plain extends WizardStep<"plain", { readonly done: true }, object> {
  readonly key = "plain";

  async run(): Promise<{ readonly done: true }> {
    return { done: true };
  }
}

describe("WizardStep", () => {
  describe("undo", () => {
    it("does nothing unless the step says how", async () => {
      const step = new Plain();

      const undone = step.undo({ done: true });

      await expect(undone).resolves.toBeUndefined();
    });
  });
});
