import { setApiBaseUrl } from "@zitadel-nextgen/api/runtime/base-url";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_EXCHANGE_PATH,
  resolveSessionExchangeUrl,
} from "./api-client.js";

describe("resolveSessionExchangeUrl", () => {
  afterEach(() => {
    setApiBaseUrl("");
  });

  it("prefixes the default path with api-base", () => {
    setApiBaseUrl("/__nextgen");
    expect(resolveSessionExchangeUrl()).toBe("/__nextgen/sessions/exchange");
    expect(resolveSessionExchangeUrl(DEFAULT_SESSION_EXCHANGE_PATH)).toBe(
      "/__nextgen/sessions/exchange",
    );
  });

  it("returns the default path alone when api-base is unset", () => {
    expect(resolveSessionExchangeUrl()).toBe("/sessions/exchange");
  });

  it("resolves a custom path from location.origin, ignoring api-base", () => {
    setApiBaseUrl("/__nextgen");
    expect(resolveSessionExchangeUrl("/api/auth/exchange")).toBe(
      `${window.location.origin}/api/auth/exchange`,
    );
  });

  it("normalises a custom path without a leading slash", () => {
    setApiBaseUrl("/__nextgen");
    expect(resolveSessionExchangeUrl("api/auth/exchange")).toBe(
      `${window.location.origin}/api/auth/exchange`,
    );
  });
});
