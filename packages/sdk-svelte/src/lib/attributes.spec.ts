import { afterEach, describe, expect, it, vi } from "vitest";

import { onClient, proxyPathAttr } from "./attributes";

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

describe("proxyPathAttr", () => {
  it("writes an empty path as /", () => {
    expect(proxyPathAttr("")).toBe("/");
  });

  it("leaves other paths and an unset path alone", () => {
    expect(proxyPathAttr("/px")).toBe("/px");
    expect(proxyPathAttr(undefined)).toBeUndefined();
  });
});
