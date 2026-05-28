import { describe, expect, it } from "vitest";

import { isRendererId, RENDERER_IDS } from "../../../../../../../src/lib/orca/patchers/next/renderers/types";

describe("RENDERER_IDS", () => {
  it("lists exactly the supported renderer ids", () => {
    expect(RENDERER_IDS).toEqual(["react", "web-component"]);
  });
});

describe("isRendererId", () => {
  for (const id of RENDERER_IDS) {
    it(`returns true for the valid id ${id}`, () => {
      expect(isRendererId(id)).toBe(true);
    });
  }

  it("returns false for an unknown string", () => {
    expect(isRendererId("vue")).toBe(false);
  });

  it("returns false for a non-string value", () => {
    expect(isRendererId(123)).toBe(false);
    expect(isRendererId(undefined)).toBe(false);
    expect(isRendererId(null)).toBe(false);
    expect(isRendererId({ id: "react" })).toBe(false);
  });
});
