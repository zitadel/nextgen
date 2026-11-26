import { describe, expect, it } from "vitest";

import { SyncError, SyncStateMalformedError, SyncStateUnreadableError } from "@/lib/sync";

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

describe("what a sync error states", () => {
  it("says to fix or remove a malformed state file", () => {
    expect(new SyncStateMalformedError("malformed")).toMatchObject({
      hint: "The file records which platform resource each local file was synced as. Fix or remove it, then run this command again.",
      details: { file: ".zitadel/state.json" },
    });
  });

  it("reports the failure an unreadable state file was read with, and no hint", () => {
    const error = new SyncStateUnreadableError("not JSON", new SyntaxError("Unexpected token"));

    expect(error).toMatchObject({
      hint: undefined,
      details: { original: { name: "SyntaxError", message: "Unexpected token" } },
    });
  });
});
