import { describe, expect, it } from "vitest";

import { GoogleProvider } from "./google.js";
import {
  idpProvider,
  IDP_PROVIDERS,
  parseProviderSelection,
  providerOf,
  selectionName,
  type CatalogProviderId,
} from "./index.js";
import { displayName, issuer, slug } from "./test-support.js";

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
    expect(() => idpProvider("okta" as CatalogProviderId)).toThrow(/unknown identity provider/);
  });

  it("does not resolve prototype keys as providers", () => {
    expect(() => idpProvider("__proto__" as CatalogProviderId)).toThrow(
      /unknown identity provider/,
    );
    expect(() => idpProvider("constructor" as CatalogProviderId)).toThrow(
      /unknown identity provider/,
    );
  });
});

describe("a provider selection", () => {
  const acme = {
    slug: slug("acme-sso"),
    displayName: displayName("Acme SSO"),
    issuer: issuer("https://sso.acme.example"),
    scopes: ["openid"] as const,
  };

  it("names a catalog provider by its id", () => {
    const selection = parseProviderSelection("google");

    expect(selection).toEqual({ kind: "catalog", id: "google" });
    expect(selection && selectionName(selection)).toBe("google");
    expect(selection && providerOf(selection).slug).toBe("google");
    expect(selection && providerOf(selection)).toBeInstanceOf(GoogleProvider);
  });

  it("names a custom connection by what the developer called it", () => {
    const selection = parseProviderSelection("custom", acme);

    expect(selection).toEqual({ kind: "custom", connection: acme });
    expect(selection && selectionName(selection)).toBe("custom");
    expect(selection && providerOf(selection).slug).toBe("acme-sso");
    expect(selection && providerOf(selection).displayName).toBe("Acme SSO");
  });

  it("is not a custom provider without the settings that describe it", () => {
    expect(parseProviderSelection("custom")).toBeUndefined();
  });

  it("is nothing for a name no provider answers to", () => {
    expect(parseProviderSelection("okta")).toBeUndefined();
    expect(parseProviderSelection("__proto__")).toBeUndefined();
  });
});
