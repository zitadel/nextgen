import { describe, expect, it } from "vitest";

import { localRuntimeStarted } from "../../../../../src/commands/local-server/requirements/local-runtime-started";
import { requirementContext } from "../../../../helpers/requirement-context";

describe("localRuntimeStarted", () => {
  it("finds nothing where no server was started, and refuses naming start", async () => {
    const found = await localRuntimeStarted.resolve(
      requirementContext({ flags: { cwd: "/nonexistent-zitadel-dir" } }),
    );

    expect(found).toBeUndefined();
    expect(localRuntimeStarted.refusal).toMatchObject({
      message: "Local Zitadel runtime has not been started",
      next: ["start"],
    });
  });
});
