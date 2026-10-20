import { describe, expect, it } from "vitest";

import * as root from "../index";

describe("package root", () => {
  it("loads and exports the server helpers", () => {
    expect(root.auth).toBeTypeOf("function");
    expect(root.NextgenProvider).toBeTypeOf("function");
    expect(root.nextgenMiddleware).toBeTypeOf("function");
  });
});
