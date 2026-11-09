import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hashForState } from "@/lib/sync/writeback";

describe("hashForState", () => {
  it("is the sha256 of the sorted, pretty-printed body", () => {
    const expected = createHash("sha256").update('{\n  "a": 1,\n  "b": 2\n}').digest("hex");

    expect(hashForState({}, { b: 2, a: 1 })).toBe(expected);
  });

  it("does not read reordered keys as an edit", () => {
    expect(hashForState({}, { name: "user", nested: { x: 1, y: 2 } })).toBe(
      hashForState({}, { nested: { y: 2, x: 1 }, name: "user" }),
    );
  });

  it("reads a changed value as an edit", () => {
    expect(hashForState({}, { name: "user" })).not.toBe(hashForState({}, { name: "admin" }));
  });

  it("hashes the normalized form, so a spelled-out default is no edit", () => {
    const dropDefaults = {
      normalize(data: object): object {
        const { enabled: _default, ...rest } = data as { enabled?: boolean };
        return rest;
      },
    };

    expect(hashForState(dropDefaults, { name: "user", enabled: true })).toBe(
      hashForState(dropDefaults, { name: "user" }),
    );
  });
});
