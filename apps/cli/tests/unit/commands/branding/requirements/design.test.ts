import { describe, expect, it } from "vitest";

import { design } from "../../../../../src/commands/branding/requirements/design";
import { requirementContext } from "../../../../helpers/requirement-context";

describe("design", () => {
  it("hands over the design that was asked for", async () => {
    await expect(
      design.resolve(requirementContext({ flags: { design: "minimal" } })),
    ).resolves.toEqual({ design: "minimal" });
  });

  it("hands over nothing when none was asked for", async () => {
    await expect(design.resolve(requirementContext())).resolves.toEqual({
      design: undefined,
    });
  });
});
