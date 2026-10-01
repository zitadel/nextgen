import { describe, expect, it } from "vitest";

import { GoogleProvider } from "./google.js";
import { isSupportedIssuer } from "./issuer.js";

describe("the issuer contract", () => {
  it("accepts the vendor's own issuer", () => {
    expect(isSupportedIssuer(new GoogleProvider().issuer)).toBe(true);
  });

  it("accepts https anywhere", () => {
    expect(isSupportedIssuer("https://accounts.example.com")).toBe(true);
    expect(isSupportedIssuer("https://tenant.example.com/oauth2/v1")).toBe(true);
  });

  it("accepts http on loopback, which is what a local stand-in serves", () => {
    expect(isSupportedIssuer("http://localhost:9100")).toBe(true);
    expect(isSupportedIssuer("http://127.0.0.1:9100")).toBe(true);
    expect(isSupportedIssuer("http://localhost")).toBe(true);
  });

  it("rejects http on any other host", () => {
    // `new URL` parses this happily, which is why the prompt cannot rely on it:
    // the value would be written and then rejected on apply.
    expect(isSupportedIssuer("http://idp.internal:9100")).toBe(false);
    expect(isSupportedIssuer("http://accounts.example.com")).toBe(false);
  });

  it("rejects a non-http scheme and a non-URL", () => {
    expect(isSupportedIssuer("file:///tmp/idp")).toBe(false);
    expect(isSupportedIssuer("ftp://example.com")).toBe(false);
    expect(isSupportedIssuer("accounts.google.com")).toBe(false);
    expect(isSupportedIssuer("")).toBe(false);
  });

  it("ignores surrounding whitespace, which a paste brings along", () => {
    expect(isSupportedIssuer("  https://accounts.google.com  ")).toBe(true);
  });
});
