import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { GoogleProvider } from "./google.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const validateConnection = new Ajv2020({ strict: false, validateFormats: false }).compile(
  JSON.parse(readFileSync(join(packageRoot, "meta-schemas/idp-connection.json"), "utf8")) as object,
);

/** The default schema's properties; the use-case schemas add name fields. */
const DEFAULT_SCHEMA_PROPERTIES = ["email"];
const PROFILE_SCHEMA_PROPERTIES = ["email", "givenName", "familyName"];

const google = new GoogleProvider();
const connection = (options: Partial<Parameters<GoogleProvider["connection"]>[0]> = {}) =>
  google.connection({ schemaProperties: DEFAULT_SCHEMA_PROPERTIES, ...options });
const oidcOf = (document: Record<string, unknown>) => document.oidc as Record<string, unknown>;

describe("the scaffolded connection", () => {
  it("passes idp-connection.json", () => {
    expect(validateConnection(connection())).toBe(true);
  });

  it("stays valid with the editor $schema pointer attached", () => {
    expect(validateConnection(connection({ schemaRef: "../meta/idp-connection.json" }))).toBe(true);
  });

  it("references both credentials and carries neither value", () => {
    expect(oidcOf(connection())).toMatchObject({
      client_id: "${{ GOOGLE_CLIENT_ID }}",
      client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
    });
  });

  it("maps only the properties the target schema defines", () => {
    expect(connection().claim_mapping).toEqual({ email: "email" });
    expect(connection({ schemaProperties: PROFILE_SCHEMA_PROPERTIES }).claim_mapping).toEqual({
      email: "email",
      givenName: "given_name",
      familyName: "family_name",
    });
  });

  it("writes no claim mapping at all when the schema shares no property", () => {
    expect(connection({ schemaProperties: [] })).not.toHaveProperty("claim_mapping");
  });

  it("narrows verified_claims with the mapping, not independently of it", () => {
    // A schema without `email` gets no email mapping, so an `email` entry in
    // verified_claims would claim to verify a value the connection never
    // supplies.
    expect(connection({ schemaProperties: ["givenName"] })).not.toHaveProperty("verified_claims");
    expect(connection({ schemaProperties: ["email"] }).verified_claims).toEqual({
      email: "email_verified",
    });
  });

  it("keeps the vendor's protocol block intact", () => {
    const document = connection();

    expect(document.subject_claim).toBe("sub");
    expect(document.verified_claims).toEqual({ email: "email_verified" });
    expect(oidcOf(document).issuer).toBe("https://accounts.google.com");
    expect(oidcOf(document).scopes).toEqual(["openid", "profile", "email"]);
    // Google reuses a signed-in session silently without it.
    expect(oidcOf(document).static_authorize_parameters).toEqual({ prompt: "select_account" });
  });

  it("copies static_authorize_parameters, so one connection cannot edit the provider", () => {
    // The provider is a shared singleton, so handing out a reference to its
    // own object would let an edit to one generated document change Google's
    // authorization behaviour for every document generated afterwards.
    const first = oidcOf(connection()).static_authorize_parameters as Record<string, string>;
    first.prompt = "none";

    expect(oidcOf(connection()).static_authorize_parameters).toEqual({
      prompt: "select_account",
    });
  });

  it("copies the scopes, so one connection cannot edit the next one's", () => {
    const first = oidcOf(connection()).scopes as string[];
    first.push("https://www.googleapis.com/auth/calendar");

    expect(oidcOf(connection()).scopes).toEqual(["openid", "profile", "email"]);
  });

  it("writes the provider's own slug unless one is given", () => {
    expect(connection().slug).toBe("google");

    const second = connection({ slug: "google_work" });
    expect(second.slug).toBe("google_work");
    // The credentials follow the slug: a second connection for the same
    // provider has its own OAuth application, and sharing one variable with
    // the first would point both at whichever was published last.
    expect(oidcOf(second)).toMatchObject({
      client_id: "${{ GOOGLE_WORK_CLIENT_ID }}",
      client_secret: "${{ GOOGLE_WORK_CLIENT_SECRET }}",
    });
    expect(validateConnection(second)).toBe(true);
  });
});

describe("endpoints", () => {
  it("names none, because Google's do not share its issuer's host", () => {
    // Google publishes a discovery document and the engine resolves them at
    // runtime; a value committed here would be a guess that ages.
    expect(oidcOf(connection())).not.toHaveProperty("authorization_endpoint");
    expect(oidcOf(connection())).not.toHaveProperty("token_endpoint");
  });

  it("points at a stand-in's issuer, and still names no endpoint", () => {
    // The engine accepts a connection naming every endpoint or none, and it
    // needs four — authorization, token, `jwks_uri`, and `userinfo_endpoint`
    // unless id_token mapping is on. A subset is rejected as
    // `idp.endpoints_partial`, so the stand-in serves its own discovery
    // document, as the vendor's does.
    const oidc = oidcOf(connection({ endpoints: { issuer: "http://localhost:9100" } }));

    expect(oidc.issuer).toBe("http://localhost:9100");
    expect(oidc).not.toHaveProperty("authorization_endpoint");
    expect(oidc).not.toHaveProperty("token_endpoint");
    // Overriding where the connection points must not change what it holds.
    expect(oidc.client_id).toBe("${{ GOOGLE_CLIENT_ID }}");
  });

  it("falls back to the vendor when the issuer is absent or empty", () => {
    expect(oidcOf(connection({ endpoints: {} })).issuer).toBe(google.issuer);
    expect(oidcOf(connection({ endpoints: { issuer: "" } })).issuer).toBe(google.issuer);
  });
});

describe("claim mapping", () => {
  it("drops rows the schema does not define", () => {
    expect(google.claimMapping(["email", "nickname"])).toEqual({ email: "email" });
  });

  it("is empty when the schema shares no property", () => {
    expect(google.claimMapping([])).toEqual({});
  });
});
