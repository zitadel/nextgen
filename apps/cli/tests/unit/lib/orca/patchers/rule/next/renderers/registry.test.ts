import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../../../../../src/lib/errors";
import {
  AVAILABLE_RENDERER_IDS,
  getRenderer,
  isRendererId,
  RENDERER_IDS,
  RENDERERS,
} from "../../../../../../../../src/lib/orca/patchers/rule/next/renderers/registry";

describe("RENDERERS", () => {
  it("contains the expected renderer ids", () => {
    expect(Object.keys(RENDERERS).sort()).toEqual(["react", "web-component"]);
  });
});

describe("RENDERER_IDS", () => {
  it("lists exactly the supported renderer ids", () => {
    expect(RENDERER_IDS).toEqual(["react", "web-component"]);
  });
});

describe("AVAILABLE_RENDERER_IDS", () => {
  it("contains only renderers getRenderer resolves (web-component stays declared-only)", () => {
    expect(AVAILABLE_RENDERER_IDS).toEqual(["react"]);
  });

  it("is exactly the ids whose spec status is available", () => {
    expect(AVAILABLE_RENDERER_IDS).toEqual(
      RENDERER_IDS.filter((id) => RENDERERS[id].status === "available"),
    );
  });
});

describe("isRendererId", () => {
  for (const id of RENDERER_IDS) {
    it(`returns true for the valid id ${id}`, () => {
      expect(isRendererId(id)).toBe(true);
    });
  }

  it("returns false for unknown or non-string values", () => {
    expect(isRendererId("vue")).toBe(false);
    expect(isRendererId(123)).toBe(false);
    expect(isRendererId(undefined)).toBe(false);
    expect(isRendererId(null)).toBe(false);
    expect(isRendererId({ id: "react" })).toBe(false);
  });
});

describe("getRenderer", () => {
  it("returns the react spec for an available renderer", () => {
    const spec = getRenderer("react");
    expect(spec).toBe(RENDERERS.react);
    expect(spec.id).toBe("react");
    expect(spec.status).toBe("available");
  });

  it("throws E_NOT_IMPLEMENTED for the declared-but-unpublished web-component renderer", () => {
    try {
      getRenderer("web-component");
      expect.unreachable("getRenderer should throw for a not-implemented renderer");
    } catch (error) {
      expect(error).toBeInstanceOf(ZitadelError);
      expect((error as ZitadelError).code).toBe("E_NOT_IMPLEMENTED");
    }
  });

  it("throws E_VALIDATION for an unknown renderer id", () => {
    try {
      getRenderer("vue");
      expect.unreachable("getRenderer should throw for an unknown renderer");
    } catch (error) {
      expect(error).toBeInstanceOf(ZitadelError);
      expect((error as ZitadelError).code).toBe("E_VALIDATION");
    }
  });

  it("does not advertise not-implemented renderers in the unknown-id hint", () => {
    try {
      getRenderer("vue");
      expect.unreachable("getRenderer should throw for an unknown renderer");
    } catch (error) {
      const hint = (error as ZitadelError).hint;
      expect(hint).toContain("react");
      expect(hint).not.toContain("web-component");
    }
  });
});
