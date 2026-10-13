import { describe, expect, it } from "vitest";

import {
  type ClientId,
  type ClientIdVariable,
  type ClientSecret,
  type ClientSecretVariable,
  type ConnectionSlug,
  credentialVariables,
  DEFAULT_SCOPES,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  type Scopes,
  variableReference,
} from "./index.js";
import { slug } from "./test-support.js";

describe("parseConnectionSlug", () => {
  it("accepts what idp-connection.json accepts", () => {
    for (const value of ["a", "acme-sso", "corp_idp", "1password", "a".repeat(64)]) {
      expect(parseConnectionSlug(value).ok, value).toBe(true);
    }
  });

  it("refuses what it refuses", () => {
    for (const value of ["", "Acme", "-a", "_a", "a b", "a.b", "a".repeat(65)]) {
      expect(parseConnectionSlug(value).ok, value).toBe(false);
    }
  });

  it("trims what surrounds the slug, as it does the other values", () => {
    expect(parseConnectionSlug("  acme-sso ")).toEqual({ ok: true, value: "acme-sso" });
  });

  it("refuses a reserved name that was typed with spaces around it", () => {
    expect(parseConnectionSlug(" google ", ["google"])).toMatchObject({ ok: false });
  });

  it("refuses a reserved name, saying why", () => {
    expect(parseConnectionSlug("google", ["google"])).toEqual({
      ok: false,
      problem: expect.stringContaining("built-in provider"),
    });
  });
});

describe("parseDisplayName", () => {
  it("wants something to show, and trims it", () => {
    expect(parseDisplayName("")).toMatchObject({ ok: false });
    expect(parseDisplayName("   ")).toMatchObject({ ok: false });
    expect(parseDisplayName("x".repeat(257))).toMatchObject({ ok: false });
    expect(parseDisplayName("  Acme SSO ")).toEqual({ ok: true, value: "Acme SSO" });
  });
});

describe("parseIssuer", () => {
  it("accepts https, and http on loopback only", () => {
    expect(parseIssuer("https://sso.acme.example").ok).toBe(true);
    expect(parseIssuer("http://localhost:9100").ok).toBe(true);
    expect(parseIssuer("http://sso.acme.example").ok).toBe(false);
    expect(parseIssuer("sso.acme.example").ok).toBe(false);
  });
});

describe("parseScopes", () => {
  it("is the default set when nothing was typed", () => {
    expect(parseScopes(undefined)).toEqual({ ok: true, value: DEFAULT_SCOPES });
    expect(parseScopes("  , ")).toEqual({ ok: true, value: DEFAULT_SCOPES });
  });

  it("splits on spaces and commas and drops repeats", () => {
    expect(parseScopes("openid, email  groups,email")).toEqual({
      ok: true,
      value: ["openid", "email", "groups"],
    });
  });

  it("puts openid first, wherever it was typed", () => {
    expect(parseScopes("profile openid")).toEqual({ ok: true, value: ["openid", "profile"] });
  });

  it("refuses a list without openid, because the provider would return no id_token", () => {
    expect(parseScopes("profile email")).toEqual({
      ok: false,
      problem: expect.stringContaining("must include openid"),
    });
  });
});

describe("parseClientId and parseClientSecret", () => {
  it("refuse nothing and whitespace, and trim the rest", () => {
    expect(parseClientId("")).toMatchObject({ ok: false });
    expect(parseClientId("  ")).toMatchObject({ ok: false });
    expect(parseClientId(" id ")).toEqual({ ok: true, value: "id" });
    expect(parseClientSecret("")).toMatchObject({ ok: false });
    expect(parseClientSecret(" s3cret ")).toEqual({ ok: true, value: "s3cret" });
  });
});

/**
 * The point of the types: each of these is a mistake that used to compile.
 * `@ts-expect-error` fails the typecheck when the line stops being an error,
 * so a regression to loose strings is caught here and not in production.
 */
describe("values that cannot be mixed up", () => {
  const variables = credentialVariables(slug("acme-sso"));

  it("keeps a variable name from standing in for the other credential's", () => {
    const wantsId = (_name: ClientIdVariable) => undefined;
    const wantsSecret = (_name: ClientSecretVariable) => undefined;

    wantsId(variables.clientId);
    wantsSecret(variables.clientSecret);
    // @ts-expect-error the secret's variable is not the client id's
    wantsId(variables.clientSecret);
    // @ts-expect-error the client id's variable is not the secret's
    wantsSecret(variables.clientId);
  });

  it("keeps a credential's value from standing in for its variable name", () => {
    // @ts-expect-error a client id is not the name of a variable
    variableReference("ACME_SSO_CLIENT_ID" as ClientId);
    // @ts-expect-error nor is a secret
    variableReference("hunter2" as ClientSecret);
    expect(variableReference(variables.clientId)).toBe("${{ ACME_SSO_CLIENT_ID }}");
  });

  it("keeps a client id and a client secret apart", () => {
    const wantsSecret = (_secret: ClientSecret) => undefined;
    // @ts-expect-error a client id is not a client secret
    wantsSecret("acme-client-id" as ClientId);
  });

  it("will not take plain text for a slug", () => {
    const wantsSlug = (_slug: ConnectionSlug) => undefined;
    // @ts-expect-error text has not been checked against the slug contract
    wantsSlug("Not A Slug");
    wantsSlug(slug("acme-sso"));
  });

  it("will not take a scope list that leaves out openid", () => {
    // @ts-expect-error openid leads, or there is no id_token
    const missing: Scopes = ["profile", "email"];
    const present: Scopes = ["openid", "profile"];
    expect([missing.length, present.length]).toEqual([2, 2]);
  });
});
