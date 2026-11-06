import { describe, expect, test } from "vitest";

import { compare } from "./order";

describe("compare", () => {
  test("orders by code point, not by locale", () => {
    expect(["b", "B", "a"].sort(compare)).toEqual(["B", "a", "b"]);
  });

  test("calls equal strings equal", () => {
    expect(compare("a", "a")).toBe(0);
  });
});
