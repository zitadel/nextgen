import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { CustomOidcProvider, DEFAULT_SCOPES } from "./index.js";
import { displayName, issuer, slug } from "./test-support.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const validateConnection = new Ajv2020({ strict: false, validateFormats: false }).compile(
  JSON.parse(readFileSync(join(packageRoot, "meta-schemas/idp-connection.json"), "utf8")) as object,
);

const input = {
  slug: slug("acme-sso"),
  displayName: displayName("Acme SSO"),
  issuer: issuer("https://sso.acme.example"),
  scopes: DEFAULT_SCOPES,
};

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
    expect((document(["email"]).oidc as { scopes: string[] }).scopes).toEqual([...DEFAULT_SCOPES]);
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

  it.each([
    [["openid"], {}, undefined],
    [["openid", "email"], { email: "email" }, { email: "email_verified" }],
    [["openid", "profile"], { givenName: "given_name", familyName: "family_name" }, undefined],
    [
      ["openid", "profile", "email"],
      { email: "email", givenName: "given_name", familyName: "family_name" },
      { email: "email_verified" },
    ],
  ])(
    "maps only the claims the scopes %j return, and verifies only what it maps",
    (scopes, mapping, verified) => {
      const narrowed = new CustomOidcProvider({
        ...input,
        scopes: scopes as unknown as typeof DEFAULT_SCOPES,
      });

      const connection = narrowed.connection({
        schemaProperties: ["email", "givenName", "familyName"],
      });

      expect(connection.claim_mapping).toEqual(
        Object.keys(mapping).length > 0 ? mapping : undefined,
      );
      expect(connection.verified_claims).toEqual(verified);
    },
  );

  it("verifies an email only when the schema makes it unique, the only case verification is read", () => {
    const withUnique = provider.connection({
      schemaProperties: ["email"],
      uniqueProperties: ["email"],
    });
    const withoutUnique = provider.connection({
      schemaProperties: ["email"],
      uniqueProperties: [],
    });

    expect(withUnique.verified_claims).toEqual({ email: "email_verified" });
    expect(withoutUnique.verified_claims).toBeUndefined();
    expect(withoutUnique.claim_mapping).toEqual({ email: "email" });
  });

  it("keeps every verification when it is not told which properties are unique", () => {
    expect(provider.connection({ schemaProperties: ["email"] }).verified_claims).toEqual({
      email: "email_verified",
    });
  });

  it("does not ask for the provider's account to be selected, as Google's does", () => {
    expect(document(["email"]).oidc).not.toHaveProperty("static_authorize_parameters");
  });
});
