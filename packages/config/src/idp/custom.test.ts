import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import {
  CUSTOM_PROVIDER,
  CustomOidcProvider,
  DEFAULT_CUSTOM_SCOPES,
  displayNameProblem,
  idpProviderFor,
  parseScopes,
  scopesProblem,
  slugProblem,
} from "./index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const validateConnection = new Ajv2020({ strict: false, validateFormats: false }).compile(
  JSON.parse(readFileSync(join(packageRoot, "meta-schemas/idp-connection.json"), "utf8")) as object,
);

const input = { slug: "acme-sso", displayName: "Acme SSO", issuer: "https://sso.acme.example" };

describe("CustomOidcProvider", () => {
  const provider = new CustomOidcProvider(input);
  const document = (schemaProperties: string[]) =>
    provider.connection({ schemaProperties, schemaRef: "../meta/idp-connection.json" });

  it("writes the developer's own name, display name and issuer", () => {
    expect(document(["email"])).toMatchObject({
      $schema: "../meta/idp-connection.json",
      slug: "acme-sso",
      protocol: "oidc",
      display_name: "Acme SSO",
      oidc: { issuer: "https://sso.acme.example" },
    });
  });

  it("writes a document the connection contract accepts", () => {
    expect(validateConnection(document(["email", "givenName", "familyName"]))).toBe(true);
    expect(validateConnection(document([]))).toBe(true);
    expect(
      validateConnection(
        new CustomOidcProvider({ ...input, scopes: ["openid"] }).connection({
          schemaProperties: ["email"],
        }),
      ),
    ).toBe(true);
  });

  it("carries no template, because it names no vendor", () => {
    expect(document(["email"])).not.toHaveProperty("template");
  });

  it("knows no console, docs or callback guidance to offer", () => {
    expect(provider.consoleUrl).toBeUndefined();
    expect(provider.docsUrl).toBeUndefined();
    expect(provider.callbackGuidance).toBeUndefined();
  });

  it("requests openid, profile and email unless told otherwise", () => {
    expect((document(["email"]).oidc as { scopes: string[] }).scopes).toEqual([
      ...DEFAULT_CUSTOM_SCOPES,
    ]);
  });

  it("requests the scopes it was given", () => {
    const narrow = new CustomOidcProvider({ ...input, scopes: ["openid", "groups"] });

    expect(
      (narrow.connection({ schemaProperties: [] }).oidc as { scopes: string[] }).scopes,
    ).toEqual(["openid", "groups"]);
  });

  it("names its credentials after the slug, as references and never values", () => {
    expect(document(["email"]).oidc).toMatchObject({
      client_id: "${{ ACME_SSO_CLIENT_ID }}",
      client_secret: "${{ ACME_SSO_CLIENT_SECRET }}",
    });
  });

  it("maps the standard claims the schema defines, and no others", () => {
    expect(document(["email", "givenName", "familyName", "staffNumber"]).claim_mapping).toEqual({
      email: "email",
      givenName: "given_name",
      familyName: "family_name",
    });
    expect(document(["staffNumber"])).not.toHaveProperty("claim_mapping");
  });

  it("trusts an email only as the provider verifies it, and only when email is mapped", () => {
    expect(document(["email"]).verified_claims).toEqual({ email: "email_verified" });
    expect(document(["givenName"])).not.toHaveProperty("verified_claims");
  });

  it("does not ask for the provider's account to be selected, as Google's does", () => {
    expect(document(["email"]).oidc).not.toHaveProperty("static_authorize_parameters");
  });
});

describe("idpProviderFor", () => {
  it("returns a catalog provider by name", () => {
    expect(idpProviderFor("google").displayName).toBe("Google");
  });

  it("builds a custom provider from what the developer supplied", () => {
    expect(idpProviderFor(CUSTOM_PROVIDER, input).slug).toBe("acme-sso");
  });

  it("refuses a custom provider with nothing describing it", () => {
    expect(() => idpProviderFor(CUSTOM_PROVIDER)).toThrow(/needs its connection settings/);
  });
});

describe("slugProblem", () => {
  it("accepts what idp-connection.json accepts", () => {
    for (const slug of ["a", "acme-sso", "corp_idp", "1password", "a".repeat(64)]) {
      expect(slugProblem(slug), slug).toBeUndefined();
    }
  });

  it("refuses what it refuses", () => {
    for (const slug of ["", "Acme", "-a", "_a", "a b", "a.b", "a".repeat(65)]) {
      expect(slugProblem(slug), slug).toBeDefined();
    }
  });

  it("refuses a reserved name, saying why", () => {
    expect(slugProblem("google", ["google"])).toContain("built-in provider");
  });
});

describe("displayNameProblem", () => {
  it("wants something to show", () => {
    expect(displayNameProblem("")).toBeDefined();
    expect(displayNameProblem(" ")).toBeDefined();
    expect(displayNameProblem("Acme SSO")).toBeUndefined();
  });
});

describe("parseScopes and scopesProblem", () => {
  it("falls back to the default set on nothing", () => {
    expect(parseScopes(undefined)).toEqual(["openid", "profile", "email"]);
    expect(parseScopes("  ,  ")).toEqual(["openid", "profile", "email"]);
  });

  it("requires openid", () => {
    expect(scopesProblem(["profile"])).toContain("openid");
    expect(scopesProblem(["openid"])).toBeUndefined();
  });
});
