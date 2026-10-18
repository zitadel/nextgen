import { afterEach, describe, expect, it, vi } from "vitest";

import { onClient, onServer } from "./attributes";

describe("onClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the value in a browser", () => {
    const value = { projectId: "p" };

    expect(onClient(value)).toBe(value);
  });

  it("returns undefined where there is no document", () => {
    vi.stubGlobal("document", undefined);

    expect(onClient({ projectId: "p" })).toBeUndefined();
  });
});

describe("onServer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns undefined in a browser", () => {
    expect(onServer({ variant: "page" })).toBeUndefined();
  });

  it("returns the value where there is no document", () => {
    vi.stubGlobal("document", undefined);

    expect(onServer({ variant: "page" })).toEqual({ variant: "page" });
  });
});
