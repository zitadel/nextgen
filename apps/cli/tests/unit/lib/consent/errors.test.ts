import { describe, expect, it } from "vitest";

import { ConsentError, ConsentInternalError } from "@/lib/consent";

describe("the consent errors", () => {
  it("reports an internal failure as a fault", () => {
    const error = new ConsentInternalError("bug");

    expect(error).toBeInstanceOf(ConsentError);
    expect(error.category).toBe("fault");
  });
});
