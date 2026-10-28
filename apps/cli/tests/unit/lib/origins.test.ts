import { describe, expect, it } from "vitest";

import { issuerHeldAsPreview, originOf, recordedOrigins } from "../../../src/lib/origins";

const ISSUER = "http://localhost:3000";

describe("issuerHeldAsPreview", () => {
  it("returns the stored pattern when the issuer is a preview origin and nothing is primary", () => {
    expect(issuerHeldAsPreview([{ pattern: ISSUER, kind: "preview" }], ISSUER)).toBe(ISSUER);
  });

  it("returns nothing when any origin is primary", () => {
    expect(
      issuerHeldAsPreview(
        [
          { pattern: ISSUER, kind: "preview" },
          { pattern: "https://app.acme.com", kind: "primary" },
        ],
        ISSUER,
      ),
    ).toBeUndefined();
  });

  it("returns nothing when the project does not hold the issuer", () => {
    expect(
      issuerHeldAsPreview([{ pattern: "https://*-acme.vercel.app", kind: "preview" }], ISSUER),
    ).toBeUndefined();
  });

  it("matches an issuer written with a trailing slash or upper-case host", () => {
    expect(
      issuerHeldAsPreview([{ pattern: ISSUER, kind: "preview" }], "http://LOCALHOST:3000/"),
    ).toBe(ISSUER);
  });
});

describe("recordedOrigins", () => {
  it("lists .zitadel/secret's patterns with their kinds", () => {
    expect(
      recordedOrigins({ primary_origins: ["https://app.acme.com"], preview_origins: [ISSUER] }),
    ).toEqual([
      { pattern: "https://app.acme.com", kind: "primary" },
      { pattern: ISSUER, kind: "preview" },
    ]);
  });
});

describe("originOf", () => {
  it("drops a trailing slash", () => {
    expect(originOf(`${ISSUER}/`)).toBe(ISSUER);
  });

  it("returns a value that is not a URL as written", () => {
    expect(originOf("not a url")).toBe("not a url");
  });
});
