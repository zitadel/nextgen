import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import { WizardError, WizardInternalError } from "@/lib/wizard";

describe("the wizard errors", () => {
  it("reports an engine guard as a fault, not worth retrying", () => {
    const error = new WizardInternalError("The wizard already has a step");

    expect(error).toBeInstanceOf(WizardError);
    expect([error.category, error.retryable]).toEqual(["fault", false]);
  });

  it("keeps the cause", () => {
    const cause = new Error("boom");

    expect(
      new WizardInternalError("undo failed", {
        cause,
      }).cause,
    ).toBe(cause);
  });

  it("is reported as E_VALIDATION, as every fault is until it has a code of its own", () => {
    expect(toZitadelError(new WizardInternalError("bad"))).toMatchObject({
      code: "E_VALIDATION",
      message: "bad",
    });
  });
});
