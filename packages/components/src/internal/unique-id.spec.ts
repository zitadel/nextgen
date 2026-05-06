import { describe, expect, it } from "vitest";

import { nextUid } from "./unique-id.js";

describe("nextUid", () => {
  it("returns monotonically increasing ids with the given prefix", () => {
    const a = nextUid("zl-test");
    const b = nextUid("zl-test");
    expect(a).not.toBe(b);
    const aIdx = Number(a.slice("zl-test-".length));
    const bIdx = Number(b.slice("zl-test-".length));
    expect(bIdx).toBeGreaterThan(aIdx);
  });
});
