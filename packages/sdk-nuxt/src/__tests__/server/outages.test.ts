import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("outages fixture", () => {
  // Every server SDK is held to one outage contract; this copy must not drift.
  it("is identical to sdk-core's canonical copy", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

    expect(read("./outages.ts")).toBe(read("../../../../sdk-core/src/__tests__/outages.ts"));
  });
});
