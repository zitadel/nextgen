import { describe, expect, it } from "vitest";

import { localAdmin } from "../../../../../src/commands/local-server/requirements/local-admin";
import { requirementContext } from "../../../../helpers/requirement-context";

describe("localAdmin", () => {
  it("finds nothing where start never created an admin, and refuses naming start", async () => {
    const found = await localAdmin.resolve(
      requirementContext({ meta: { cwd: "/nonexistent-zitadel-dir" } }),
    );

    expect(found).toBeUndefined();
    expect(localAdmin.refusal).toMatchObject({
      message: "No local admin in this directory or its parents",
      next: ["start"],
    });
  });
});
