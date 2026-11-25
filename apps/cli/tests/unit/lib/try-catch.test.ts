import { describe, expect, it } from "vitest";

import { tryCatch } from "@/lib/try-catch";

describe("tryCatch", () => {
  it("returns the result with no error when the function returns", () => {
    expect(tryCatch(JSON.parse, '{"a":1}')).toEqual([null, { a: 1 }]);
  });

  it("returns the error with no result when the function throws", () => {
    const [error, value] = tryCatch(JSON.parse, "{");

    expect(error).toBeInstanceOf(SyntaxError);
    expect(value).toBeUndefined();
  });

  it("passes every argument through", () => {
    expect(tryCatch(Math.max, 1, 3, 2)).toEqual([null, 3]);
  });

  it("wraps a thrown value that is not an error", () => {
    const [error] = tryCatch(() => {
      throw "boom";
    });

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("boom");
  });

  it("keeps a falsy result distinct from a failure", () => {
    expect(tryCatch(() => 0)).toEqual([null, 0]);
  });
});
