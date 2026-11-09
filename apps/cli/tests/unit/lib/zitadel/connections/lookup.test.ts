import { describe, expect, it } from "vitest";

import { idpProvider } from "@zitadel/config/idp";

import { Connection, UserSchema } from "@/lib/zitadel";
import { sameIssuer, unappliedSettings } from "@/lib/zitadel/connections/lookup";

const IDPS = ".zitadel/idps";

const schema = UserSchema.of({
  path: ".zitadel/schemas/customers.json",
  body: { objectType: "customers", properties: { email: { type: "string" } } },
});

const google = Connection.forProvider(idpProvider("google"), schema);

function connection(name: string, body: Record<string, unknown>): Connection {
  return Connection.of({ path: `${IDPS}/${name}`, body });
}

function googleBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "google",
    protocol: "oidc",
    template: "google",
    display_name: "Google",
    oidc: {
      issuer: "https://accounts.google.com",
      client_id: "111.apps.googleusercontent.com",
      client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      scopes: ["openid"],
    },
    ...over,
  };
}

describe("sameIssuer", () => {
  it("names the connections that reach the candidate's issuer under another slug", () => {
    const work = connection(
      "google-work.json",
      googleBody({
        slug: "google-work",
        template: undefined,
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ WORK_CLIENT_ID }}",
          client_secret: "${{ WORK_CLIENT_SECRET }}",
        },
      }),
    );

    expect(sameIssuer([work], google)).toEqual([`${IDPS}/google-work.json`]);
  });

  it("ignores connections that name no issuer", () => {
    expect(sameIssuer([connection("okta.json", { slug: "okta" })], google)).toEqual([]);
  });
});

describe("unappliedSettings", () => {
  const existing = connection("acme-sso.json", {
    slug: "acme-sso",
    display_name: "Acme SSO",
    oidc: { issuer: "https://sso.acme.example", scopes: ["openid", "profile", "email"] },
  });

  function candidate(over: Record<string, unknown>): Connection {
    return Connection.create({
      path: `${IDPS}/acme-sso.json`,
      body: {
        slug: "acme-sso",
        display_name: "Acme SSO",
        oidc: { issuer: "https://sso.acme.example", scopes: ["openid", "profile", "email"] },
        ...over,
      },
    });
  }

  it("names scopes that were given and differ", () => {
    const given = candidate({ oidc: { scopes: ["openid", "groups"] } });

    expect(unappliedSettings(existing, given, ["scopes"])).toEqual(["scopes"]);
  });

  it("says nothing about scopes that were not given", () => {
    const given = candidate({ oidc: { scopes: ["openid", "groups"] } });

    expect(unappliedSettings(existing, given, [])).toEqual([]);
  });

  it("names a display name that differs", () => {
    const given = candidate({ display_name: "New name" });

    expect(unappliedSettings(existing, given, ["display name", "scopes"])).toEqual([
      "display name",
    ]);
  });

  it("says nothing about settings the file already has", () => {
    expect(unappliedSettings(existing, candidate({}), ["display name", "scopes"])).toEqual([]);
  });
});

