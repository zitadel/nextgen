import * as root from "@zitadel/sdk-next";
import { describe, expect, it } from "vitest";

describe("the package root in the edge runtime", () => {
  it("loads and exports the server helpers", () => {
    expect(root.auth).toBeTypeOf("function");
    expect(root.NextgenProvider).toBeTypeOf("function");
    expect(root.nextgenMiddleware).toBeTypeOf("function");
  });
});
