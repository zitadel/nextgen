import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_EXCHANGE_PATH,
  resolveSessionExchangeUrl,
} from "./api-client.js";

describe("resolveSessionExchangeUrl", () => {
  it("prefixes the default path with api-base", () => {
    expect(resolveSessionExchangeUrl("/__nextgen")).toBe("/__nextgen/sessions/exchange");
    expect(resolveSessionExchangeUrl("/__nextgen", DEFAULT_SESSION_EXCHANGE_PATH)).toBe(
      "/__nextgen/sessions/exchange",
    );
  });

  it("returns the default path alone when api-base is empty", () => {
    expect(resolveSessionExchangeUrl("")).toBe("/sessions/exchange");
  });

  it("resolves a custom path from location.origin, ignoring api-base", () => {
    expect(resolveSessionExchangeUrl("/__nextgen", "/api/auth/exchange")).toBe(
      `${window.location.origin}/api/auth/exchange`,
    );
  });

  it("normalises a custom path without a leading slash", () => {
    expect(resolveSessionExchangeUrl("/__nextgen", "api/auth/exchange")).toBe(
      `${window.location.origin}/api/auth/exchange`,
    );
  });
});
