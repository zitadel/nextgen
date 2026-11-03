import { describe, expect, it } from "vitest";

import { recordedRuntime } from "../../../../../src/commands/local-server/requirements/recorded-runtime";
import { requirementContext } from "../../../../helpers/requirement-context";

describe("recordedRuntime", () => {
  it("is found as nothing, not refused, where no server was started", async () => {
    const found = await recordedRuntime.resolve(
      requirementContext({ meta: { cwd: "/nonexistent-zitadel-dir" } }),
    );

    expect(found).toEqual({ runtime: undefined });
    expect(recordedRuntime.refusal).toBeUndefined();
    expect(recordedRuntime.source?.({ runtime: undefined })).toBe("http://localhost:8080");
  });
});
