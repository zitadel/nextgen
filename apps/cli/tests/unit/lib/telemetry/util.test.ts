import { describe, expect, it } from "vitest";

import { compact } from "../../../../src/lib/telemetry/util";

describe("compact", () => {
  it("drops empty values but keeps zero and false", () => {
    expect(compact({ a: 0, b: false, c: "", d: null, e: undefined, f: "x" })).toEqual({
      a: 0,
      b: false,
      f: "x",
    });
  });

  it("does not mutate the input", () => {
    const input = { a: 1, b: "" };
    compact(input);
    expect(input).toEqual({ a: 1, b: "" });
  });
});
