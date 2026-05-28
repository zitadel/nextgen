import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import { getRenderer, RENDERERS } from "../../../src/renderers/registry";

describe("RENDERERS", () => {
  it("contains the expected renderer ids", () => {
    expect(Object.keys(RENDERERS).sort()).toEqual(["react", "web-component"]);
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
});
