import { describe, expect, it } from "vitest";

import { GoogleProvider } from "./google.js";
import { idpProvider, IDP_PROVIDERS } from "./index.js";

describe("the provider registry", () => {
  it("ships google, and nothing github (deferred to #1082)", () => {
    expect([...IDP_PROVIDERS]).toEqual(["google"]);
  });

  it("resolves a slug to that provider's class", () => {
    expect(idpProvider("google")).toBeInstanceOf(GoogleProvider);
  });

  it("returns the same instance every time, so nothing can be mutated apart", () => {
    expect(idpProvider("google")).toBe(idpProvider("google"));
  });

  it("rejects an unknown provider by name", () => {
    expect(() => idpProvider("okta")).toThrow(/unknown identity provider/);
  });

  it("does not resolve prototype keys as providers", () => {
    expect(() => idpProvider("__proto__")).toThrow(/unknown identity provider/);
    expect(() => idpProvider("constructor")).toThrow(/unknown identity provider/);
  });
});
