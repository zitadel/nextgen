import { NextgenProvider, getAuth } from "@zitadel/sdk-next/server";
import { describe, expect, it } from "vitest";

describe("the server entry in the edge runtime", () => {
  it("loads and exports the server helpers", () => {
    expect(getAuth).toBeTypeOf("function");
    expect(NextgenProvider).toBeTypeOf("function");
  });
});
