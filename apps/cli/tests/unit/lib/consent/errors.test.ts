import { describe, expect, it } from "vitest";

import { ConsentError, ConsentInternalError } from "@/lib/consent";
import { toZitadelError } from "@/lib/errors";

describe("the consent errors", () => {
  it("reports a fault failure by its category", () => {
    const error = new ConsentInternalError("bug");

    expect(error).toBeInstanceOf(ConsentError);
    expect(error.category).toBe("fault");
  });

  it("reports an internal failure by its category", () => {
    expect(toZitadelError(new ConsentInternalError("bug")).code).toBe("E_VALIDATION");
  });
});
