import { describe, expect, it } from "vitest";

import { orDefault } from "./or-default.js";

describe("orDefault", () => {
  it.each([undefined, null, ""])("returns the fallback for %j", (value) => {
    expect(orDefault(value, "fallback")).toBe("fallback");
  });

  it.each(["set", " ", "0"])("keeps the given value %j", (value) => {
    expect(orDefault(value, "fallback")).toBe(value);
  });
});
