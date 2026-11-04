import { describe, expect, it } from "vitest";

import { Origin, Origins } from "../../../../../src/lib/backend/services/origin";

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

const ISSUER = "http://localhost:3000";

describe("Origins.heldAsPreview", () => {
  it("returns the stored pattern when the issuer is a preview origin and nothing is primary", () => {
    expect(Origins.wrap([{ pattern: ISSUER, kind: "preview" }]).heldAsPreview(ISSUER)).toBe(ISSUER);
  });

  it("returns nothing when any origin is primary", () => {
    expect(
      Origins.wrap([
        { pattern: ISSUER, kind: "preview" },
        { pattern: "https://app.acme.com", kind: "primary" },
      ]).heldAsPreview(ISSUER),
    ).toBeUndefined();
  });

  it("returns nothing when the project does not hold the issuer", () => {
    expect(
      Origins.wrap([{ pattern: "https://*-acme.vercel.app", kind: "preview" }]).heldAsPreview(
        ISSUER,
      ),
    ).toBeUndefined();
  });

  it("matches an issuer written with a trailing slash or upper-case host", () => {
    expect(
      Origins.wrap([{ pattern: ISSUER, kind: "preview" }]).heldAsPreview("http://LOCALHOST:3000/"),
    ).toBe(ISSUER);
  });
});

describe("Origins.kindOf", () => {
  const origins = Origins.wrap([
    { pattern: "https://app.acme.com", kind: "primary" },
    { pattern: "https://*.preview.acme.com", kind: "preview" },
  ]);

  it("calls an exact primary pattern primary", () => {
    expect(origins.kindOf("https://app.acme.com")).toBe("primary");
  });

  it("calls a URL a preview pattern covers preview", () => {
    expect(origins.kindOf("https://pr-7.preview.acme.com")).toBe("preview");
  });

  it("calls any other URL unknown", () => {
    expect(origins.kindOf("https://other.acme.com")).toBe("unknown");
  });
});

describe("Origins.originOf", () => {
  it("drops a trailing slash", () => {
    expect(Origins.originOf(`${ISSUER}/`)).toBe(ISSUER);
  });

  it("returns a value that is not a URL as written", () => {
    expect(Origins.originOf("not a url")).toBe("not a url");
  });
});
