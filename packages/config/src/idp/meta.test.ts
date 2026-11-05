import { describe, expect, it } from "vitest";

import { connectionLimits } from "./meta.js";

describe("connectionLimits", () => {
  it("reads the slug rule the server enforces", () => {
    expect(connectionLimits.slug).toMatchObject({
      pattern: "^[a-z0-9][a-z0-9_-]*$",
      maxLength: 64,
    });
  });

  it("reads the display name cap", () => {
    expect(connectionLimits.displayName).toMatchObject({ minLength: 1, maxLength: 256 });
  });

  it("reads the issuer pattern, which allows https and http on loopback only", () => {
    const issuer = new RegExp(connectionLimits.issuer.pattern ?? "^$");

    expect(issuer.test("https://sso.acme.example")).toBe(true);
    expect(issuer.test("http://localhost:9100")).toBe(true);
    expect(issuer.test("http://sso.acme.example")).toBe(false);
  });
});
