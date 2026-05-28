import { describe, expect, it } from "vitest";

import { getAdapter } from "../../../src/adapters/registry";
import { NextAdapter } from "../../../src/adapters/next/adapter";

describe("getAdapter", () => {
  it("returns the Next adapter for the 'next' id", () => {
    const adapter = getAdapter("next");
    expect(adapter).toBeInstanceOf(NextAdapter);
  });

  it("returns an adapter whose id and displayName match Next.js", () => {
    const adapter = getAdapter("next");
    expect(adapter.id).toBe("next");
    expect(adapter.displayName).toBe("Next.js App Router");
  });

  it("exposes the FrameworkAdapter planning surface", () => {
    const adapter = getAdapter("next");
    expect(typeof adapter.planSetup).toBe("function");
    expect(typeof adapter.planAddLogin).toBe("function");
    expect(typeof adapter.planAddRegister).toBe("function");
    expect(typeof adapter.sdkDependency).toBe("function");
  });
});
