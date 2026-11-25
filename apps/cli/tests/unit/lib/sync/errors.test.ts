import { describe, expect, it } from "vitest";

import { SyncError, SyncStateMalformedError } from "@/lib/sync";

describe("the sync errors", () => {
  it("reports a malformed state as a validation failure", () => {
    const error = new SyncStateMalformedError(
      "Cannot read .zitadel/state.json: it is not valid JSON",
    );

    expect(error).toBeInstanceOf(SyncError);
    expect(error.category).toBe("invalid");
    expect(error.code).toBe("E_VALIDATION");
    expect(error.message).toBe("Cannot read .zitadel/state.json: it is not valid JSON");
  });

  it("keeps the cause", () => {
    const cause = new SyntaxError("bad");

    expect(new SyncStateMalformedError("Cannot read f: p", cause).cause).toBe(cause);
  });
});
