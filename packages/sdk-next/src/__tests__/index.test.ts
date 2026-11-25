import { describe, expect, it } from "vitest";

import * as root from "../index";

describe("package root", () => {
  it("loads and exports the server helpers", () => {
    expect(root.getAuth).toBeTypeOf("function");
    expect(root.NextgenProvider).toBeTypeOf("function");
    expect(root.createNextgenMiddleware).toBeTypeOf("function");
  });
});
