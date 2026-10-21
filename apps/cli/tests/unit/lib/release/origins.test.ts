import { describe, expect, it } from "vitest";

import { originMatchesPattern } from "../../../../src/lib/release/origins";

describe("originMatchesPattern", () => {
  it("lets a wildcard stand for one label", () => {
    expect(
      originMatchesPattern("https://*.preview.acme.com", "https://pr-7.preview.acme.com"),
    ).toBe(true);
  });

  it("never lets a wildcard cross a dot", () => {
    expect(originMatchesPattern("https://*.preview.acme.com", "https://a.b.preview.acme.com")).toBe(
      false,
    );
  });

  it("matches a pattern with no wildcard only exactly", () => {
    expect(originMatchesPattern("https://app.acme.com", "https://app.acme.com:8443")).toBe(false);
  });
});
