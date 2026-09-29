import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import {
  claimMappingFor,
  clientSecretReference,
  clientSecretVariableName,
  IDP_CATALOG,
  IDP_PROVIDERS,
  idpCatalogEntry,
  scaffoldConnection,
} from "./idp-catalog.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const loadJson = (path: string) =>
  JSON.parse(readFileSync(join(packageRoot, path), "utf8")) as object;

const ajv = () => new Ajv2020({ strict: false, validateFormats: false });
const validateCatalog = ajv().compile(
  loadJson("defaults/idp-catalog.schema.json"),
);
const validateConnection = ajv().compile(
  loadJson("meta-schemas/idp-connection.json"),
);

/** The default schema's properties; the use-case schemas add name fields. */
const DEFAULT_SCHEMA_PROPERTIES = ["email"];
const PROFILE_SCHEMA_PROPERTIES = ["email", "givenName", "familyName"];

describe("the catalog table", () => {
  it("validates against its own schema", () => {
    expect(validateCatalog(loadJson("defaults/idp-catalog.json"))).toBe(true);
  });

  it("ships google, and nothing github (deferred to #1082)", () => {
    expect(IDP_PROVIDERS).toEqual(["google"]);
  });

  it("does not expose the file's $schema pointer as a provider", () => {
    expect(Object.keys(IDP_CATALOG)).not.toContain("$schema");
  });

  it("carries no credential material", () => {
    const serialized = JSON.stringify(IDP_CATALOG);
    expect(serialized).not.toMatch(/client_id/);
    expect(serialized).not.toMatch(/client_secret/);
  });

  it("rejects an unknown provider by name", () => {
    expect(() => idpCatalogEntry("okta")).toThrow(/unknown identity provider/);
  });

  it("does not resolve prototype keys as providers", () => {
    expect(() => idpCatalogEntry("__proto__")).toThrow(
      /unknown identity provider/,
    );
    expect(() => idpCatalogEntry("constructor")).toThrow(
      /unknown identity provider/,
    );
  });
});

describe("the scaffolded connection", () => {
  it("passes idp-connection.json with a placeholder client id", () => {
    const connection = scaffoldConnection({
      provider: "google",
      clientId: "placeholder.apps.googleusercontent.com",
      schemaProperties: DEFAULT_SCHEMA_PROPERTIES,
    });

    expect(validateConnection(connection)).toBe(true);
  });

  it("references the secret and never carries its value", () => {
    const connection = scaffoldConnection({
      provider: "google",
      clientId: "abc",
      schemaProperties: DEFAULT_SCHEMA_PROPERTIES,
    }) as { oidc: { client_secret: string } };

    expect(connection.oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");
  });

  it("maps only the properties the target schema defines", () => {
    const onDefault = scaffoldConnection({
      provider: "google",
      clientId: "abc",
      schemaProperties: DEFAULT_SCHEMA_PROPERTIES,
    }) as { claim_mapping: Record<string, string> };
    const onProfile = scaffoldConnection({
      provider: "google",
      clientId: "abc",
      schemaProperties: PROFILE_SCHEMA_PROPERTIES,
    }) as { claim_mapping: Record<string, string> };

    expect(onDefault.claim_mapping).toEqual({ email: "email" });
    expect(onProfile.claim_mapping).toEqual({
      email: "email",
      givenName: "given_name",
      familyName: "family_name",
    });
  });

  it("keeps the vendor's protocol block intact", () => {
    const connection = scaffoldConnection({
      provider: "google",
      clientId: "abc",
      schemaProperties: DEFAULT_SCHEMA_PROPERTIES,
    }) as {
      subject_claim: string;
      verified_claims: Record<string, string>;
      oidc: { issuer: string; scopes: string[] };
    };

    expect(connection.subject_claim).toBe("sub");
    expect(connection.verified_claims).toEqual({ email: "email_verified" });
    expect(connection.oidc.issuer).toBe("https://accounts.google.com");
    expect(connection.oidc.scopes).toContain("openid");
  });

  it("writes the entry key as the slug unless one is given", () => {
    const connection = scaffoldConnection({
      provider: "google",
      clientId: "abc",
      schemaProperties: DEFAULT_SCHEMA_PROPERTIES,
      slug: "google_work",
    }) as { slug: string; oidc: { client_secret: string } };

    expect(connection.slug).toBe("google_work");
    expect(connection.oidc.client_secret).toBe(
      "${{ GOOGLE_WORK_CLIENT_SECRET }}",
    );
    expect(validateConnection(connection)).toBe(true);
  });

  it("stays valid with the editor $schema pointer attached", () => {
    const connection = scaffoldConnection({
      provider: "google",
      clientId: "abc",
      schemaProperties: DEFAULT_SCHEMA_PROPERTIES,
      schemaRef: "../meta/idp-connection.json",
    });

    expect(validateConnection(connection)).toBe(true);
  });
});

describe("the client-secret variable name", () => {
  it("uppercases the slug and suffixes it", () => {
    expect(clientSecretVariableName("google")).toBe("GOOGLE_CLIENT_SECRET");
  });

  it("replaces every non-alphanumeric", () => {
    expect(clientSecretVariableName("corp-idp_eu")).toBe(
      "CORP_IDP_EU_CLIENT_SECRET",
    );
  });

  it("prefixes a leading digit, which no shell accepts", () => {
    expect(clientSecretVariableName("1password")).toBe(
      "_1PASSWORD_CLIENT_SECRET",
    );
  });

  it("references the name as a whole value", () => {
    expect(clientSecretReference("google")).toBe("${{ GOOGLE_CLIENT_SECRET }}");
  });
});

describe("claim mapping", () => {
  it("drops rows the schema does not define", () => {
    expect(
      claimMappingFor(idpCatalogEntry("google"), ["email", "nickname"]),
    ).toEqual({ email: "email" });
  });

  it("is empty when the schema shares no property", () => {
    expect(claimMappingFor(idpCatalogEntry("google"), [])).toEqual({});
  });
});

describe("scaffoldConnection endpoints", () => {
  const base = { provider: "google", schemaProperties: ["email"] } as const;

  it("keeps the catalog's issuer when nothing overrides it", () => {
    const oidc = scaffoldConnection({ ...base }).oidc as Record<string, unknown>;

    expect(oidc.issuer).toBe("https://accounts.google.com");
    // The templates name no endpoints on purpose: the engine derives
    // `<issuer>/authorize` and `<issuer>/token` from the issuer.
    expect(oidc.authorization_endpoint).toBeUndefined();
    expect(oidc.token_endpoint).toBeUndefined();
  });

  it("names every endpoint once the issuer points at a stand-in", () => {
    // The document says where it goes rather than leaving a reader to work
    // out what the engine derives, and a connection naming them all is taken
    // as authoritative instead of consulting discovery, which a stand-in may
    // not serve.
    const oidc = scaffoldConnection({
      ...base,
      endpoints: { issuer: "http://localhost:9100" },
    }).oidc as Record<string, unknown>;

    // The vendor's own paths, moved onto the stand-in's origin: a stand-in
    // should answer where the provider answers and differ only in hosting.
    expect(oidc.issuer).toBe("http://localhost:9100");
    expect(oidc.authorization_endpoint).toBe("http://localhost:9100/o/oauth2/v2/auth");
    expect(oidc.token_endpoint).toBe("http://localhost:9100/token");
  });

  it("writes nothing when the issuer is the vendor's own", () => {
    // Google's endpoints are not `<issuer>/authorize` and `<issuer>/token`;
    // the catalog names none so discovery resolves them. Writing a derived
    // guess here would break the one connection that needs no help.
    const oidc = scaffoldConnection({
      ...base,
      endpoints: { issuer: "https://accounts.google.com" },
    }).oidc as Record<string, unknown>;

    expect(oidc.issuer).toBe("https://accounts.google.com");
    expect(oidc.authorization_endpoint).toBeUndefined();
    expect(oidc.token_endpoint).toBeUndefined();
  });

  it("names the endpoints when the stand-in's paths differ", () => {
    const oidc = scaffoldConnection({
      ...base,
      endpoints: {
        issuer: "http://localhost:9100",
        authorizationEndpoint: "http://localhost:9100/oauth/authorize",
        tokenEndpoint: "http://localhost:9100/oauth/token",
      },
    }).oidc as Record<string, unknown>;

    expect(oidc.authorization_endpoint).toBe("http://localhost:9100/oauth/authorize");
    expect(oidc.token_endpoint).toBe("http://localhost:9100/oauth/token");
  });

  it("leaves the credentials as references whatever the endpoints are", () => {
    // Overriding where the connection points must not change what it holds.
    const oidc = scaffoldConnection({
      ...base,
      endpoints: { issuer: "http://localhost:9100" },
    }).oidc as Record<string, unknown>;

    expect(oidc.client_id).toBe("${{ GOOGLE_CLIENT_ID }}");
    expect(oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");
  });
});
