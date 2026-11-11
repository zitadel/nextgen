import { describe, expect, it } from "vitest";

import { renderCount } from "@/lib/count";

describe("renderCount", () => {
  it("uses the singular for one", () => {
    expect(renderCount(1, { singular: "schema" })).toBe("1 schema");
  });

  it("adds an s when the noun names no plural", () => {
    expect(renderCount(12, { singular: "resource" })).toBe("12 resources");
  });

  it("uses the noun's own plural when it has one", () => {
    expect(renderCount(2, { singular: "flow definition", plural: "flow definitions" })).toBe(
      "2 flow definitions",
    );
  });

  it("counts none in the plural", () => {
    expect(renderCount(0, { singular: "operation" })).toBe("0 operations");
  });
});
