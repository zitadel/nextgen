import { describe, expect, it } from "vitest";

import { toZitadelError } from "@/lib/errors";
import { SyncError, SyncStateMalformedError } from "@/lib/sync";

describe("the sync errors", () => {
  it("reports a malformed state as a validation failure", () => {
    const error = new SyncStateMalformedError(".zitadel/state.json", "it is not valid JSON");

    expect(error).toBeInstanceOf(SyncError);
    expect(error.category).toBe("invalid");
    expect(toZitadelError(error)).toMatchObject({
      code: "E_VALIDATION",
      message: "Cannot read .zitadel/state.json: it is not valid JSON",
      details: {
        file: ".zitadel/state.json",
      },
    });
  });

  it("keeps the cause", () => {
    const cause = new SyntaxError("bad");

    expect(
      new SyncStateMalformedError("f", "p", {
        cause,
      }).cause,
    ).toBe(cause);
  });
});
