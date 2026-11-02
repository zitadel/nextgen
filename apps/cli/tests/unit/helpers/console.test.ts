import { describe, expect, it } from "vitest";

describe("the console under the shared setup", () => {
  it("has the standard Console constructor, which a table renderer builds", () => {
    expect(() => new console.Console(process.stdout)).not.toThrow();
  });
});
