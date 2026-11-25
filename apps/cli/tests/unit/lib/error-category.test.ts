import { describe, expect, it } from "vitest";

import { ERROR_CATEGORIES, isCategorized } from "@/lib/error-category";

describe("isCategorized", () => {
  it.each(ERROR_CATEGORIES)("accepts an error whose category is %s", (category) => {
    expect(isCategorized(Object.assign(new Error("why"), { category }))).toBe(true);
  });

  it("refuses an error with no category", () => {
    expect(isCategorized(new Error("why"))).toBe(false);
  });

  it("refuses an error whose category is not one of the set", () => {
    expect(isCategorized(Object.assign(new Error("why"), { category: "other" }))).toBe(false);
  });

  it("refuses a value that is not an error", () => {
    expect(isCategorized({ category: "validation" })).toBe(false);
  });
});
