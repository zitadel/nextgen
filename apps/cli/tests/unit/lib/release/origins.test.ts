import { describe, expect, it } from "vitest";

import { assertPrimaryOrigin, originMatchesPattern } from "../../../../src/lib/release/origins";

const ORIGINS = [
  { pattern: "https://app.acme.com", kind: "primary" },
  { pattern: "https://*.preview.acme.com", kind: "preview" },
];
const UNKNOWN = { hint: "add it", nextCommands: [] };

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

describe("assertPrimaryOrigin", () => {
  it("accepts a primary origin", () => {
    expect(() => assertPrimaryOrigin(ORIGINS, "https://app.acme.com", UNKNOWN)).not.toThrow();
  });

  it("refuses a URL a preview pattern covers", () => {
    expect(() => assertPrimaryOrigin(ORIGINS, "https://pr-7.preview.acme.com", UNKNOWN)).toThrow(
      /is a preview origin/,
    );
  });

  it("refuses an origin the project does not hold, with the hint it was given", () => {
    expect(() => assertPrimaryOrigin(ORIGINS, "https://other.example", UNKNOWN)).toThrow(
      expect.objectContaining({ code: "E_VALIDATION", hint: "add it" }),
    );
  });
});
