import { describe, expect, it } from "vitest";

import { OriginService } from "../../../../src/lib/backend/origin-service";

describe("OriginService.matches", () => {
  it("lets a wildcard stand for one label", () => {
    expect(
      OriginService.matches("https://*.preview.acme.com", "https://pr-7.preview.acme.com"),
    ).toBe(true);
  });

  it("never lets a wildcard cross a dot", () => {
    expect(
      OriginService.matches("https://*.preview.acme.com", "https://a.b.preview.acme.com"),
    ).toBe(false);
  });

  it("matches a pattern with no wildcard only exactly", () => {
    expect(OriginService.matches("https://app.acme.com", "https://app.acme.com:8443")).toBe(false);
  });
});
