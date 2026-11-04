import { describe, expect, it } from "vitest";

import { Origin } from "../../../../src/lib/backend/origin-service";

describe("Origin.matches", () => {
  it("lets a wildcard stand for one label", () => {
    expect(
      Origin.of({ pattern: "https://*.preview.acme.com", kind: "preview" }).matches(
        "https://pr-7.preview.acme.com",
      ),
    ).toBe(true);
  });

  it("never lets a wildcard cross a dot", () => {
    expect(
      Origin.of({ pattern: "https://*.preview.acme.com", kind: "preview" }).matches(
        "https://a.b.preview.acme.com",
      ),
    ).toBe(false);
  });

  it("matches a pattern with no wildcard only exactly", () => {
    expect(
      Origin.of({ pattern: "https://app.acme.com", kind: "primary" }).matches(
        "https://app.acme.com:8443",
      ),
    ).toBe(false);
  });
});
