import { describe, expect, it } from "vitest";

import { WizardDefinitionError, WizardError } from "@/lib/wizard";

describe("the wizard errors", () => {
  it("reports an engine guard as a fault, not worth retrying", () => {
    const error = new WizardDefinitionError("The wizard already has a step");

    expect(error).toBeInstanceOf(WizardError);
    expect([error.category, error.retryable]).toEqual(["fault", false]);
  });

  it("keeps the cause", () => {
    const cause = new Error("boom");

    expect(new WizardDefinitionError("undo failed", cause).cause).toBe(cause);
  });
});

describe("what WizardDefinitionError states", () => {
  it("reports itself as the failure it is", () => {
    expect(new WizardDefinitionError("fatal: bad").details).toEqual({
      original: { name: "WizardDefinitionError", message: "fatal: bad", code: undefined },
    });
  });
});
