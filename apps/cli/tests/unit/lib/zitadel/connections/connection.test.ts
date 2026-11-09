import { describe, expect, it } from "vitest";

import { CustomOidcProvider, idpProvider } from "@zitadel/config/idp";

import { Connection, UserSchema } from "@/lib/zitadel";
import { displayName, issuer, slug } from "@tests/helpers/idp-values";

const IDPS = ".zitadel/idps";

const schema = UserSchema.of({
  path: ".zitadel/schemas/customers.json",
  body: { objectType: "customers", properties: { email: { type: "string" } } },
});

function connection(name: string, body: Record<string, unknown>): Connection {
  return Connection.of({ path: `${IDPS}/${name}`, body });
}

describe("Connection.credentialNames", () => {
  it("names no variable for a connection with no usable slug and no references", () => {
    const bare = connection("x.json", { oidc: { issuer: "https://x.example" } });

    expect(bare.credentialNames).toEqual({ clientId: undefined, clientSecret: undefined });
  });

  it("derives the variables from the slug for a field the file leaves out", () => {
    const bare = connection("acme.json", { slug: "acme", oidc: { issuer: "https://x.example" } });

    expect(bare.credentialNames).toEqual({
      clientId: "ACME_CLIENT_ID",
      clientSecret: "ACME_CLIENT_SECRET",
    });
  });

  it("reads the variable a field references, not the one its slug implies", () => {
    const okta = connection("okta.json", {
      slug: "okta",
      oidc: {
        issuer: "https://acme.okta.com",
        client_id: "${{ OKTA_CLIENT_ID }}",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      },
    });

    expect(okta.credentialNames).toEqual({
      clientId: "OKTA_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
    });
  });

  it("names no variable for a client id the file holds as a value", () => {
    const literal = connection("google.json", {
      slug: "google",
      oidc: {
        issuer: "https://accounts.google.com",
        client_id: "824.apps.googleusercontent.com",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      },
    });

    expect(literal.credentialNames).toEqual({
      clientId: undefined,
      clientSecret: "GOOGLE_CLIENT_SECRET",
    });
  });

  it("lists only the variables it names", () => {
    const literal = connection("google.json", {
      slug: "google",
      oidc: { client_id: "824.apps.googleusercontent.com" },
    });

    expect(literal.variableNames).toEqual(["GOOGLE_CLIENT_SECRET"]);
  });
});

describe("Connection settings as written", () => {
  it("reads the display name and issuer the file holds", () => {
    const acme = connection("acme-sso.json", {
      slug: "acme-sso",
      display_name: "Acme SSO",
      oidc: { issuer: "https://sso.acme.example" },
    });

    expect({ displayName: acme.displayName, issuer: acme.issuer }).toEqual({
      displayName: "Acme SSO",
      issuer: "https://sso.acme.example",
    });
  });

  it("reads nothing a file leaves out or holds as something other than text", () => {
    const odd = connection("acme-sso.json", { slug: "acme-sso", oidc: { issuer: 3 } });

    expect({ displayName: odd.displayName, issuer: odd.issuer }).toEqual({
      displayName: undefined,
      issuer: undefined,
    });
  });

  it("is called by its file name when it has no slug", () => {
    expect(connection("okta.json", {}).name).toBe("okta");
  });

  it("has no usable slug when the slug is malformed", () => {
    expect(connection("okta.json", { slug: "Okta" }).validSlug).toBeUndefined();
  });

  it("declares its slug even when the file spells it with spaces", () => {
    expect(connection("acme-sso.json", { slug: " acme-sso " }).declares("acme-sso")).toBe(true);
  });
});

describe("Connection.forProvider", () => {
  it("writes a catalog provider to the file its slug names, as a new file", () => {
    const google = Connection.forProvider(idpProvider("google"), schema);

    expect({ path: google.path, status: google.status, template: google.template }).toEqual({
      path: `${IDPS}/google.json`,
      status: "created",
      template: "google",
    });
  });

  it("maps only the properties the schema defines", () => {
    const google = Connection.forProvider(idpProvider("google"), schema);

    expect(
      google.mappings.map((row) => {
        return row.property;
      }),
    ).toEqual(["email"]);
  });

  it("writes a connection of the developer's own with no template, named after its slug", () => {
    const acme = Connection.forProvider(
      new CustomOidcProvider({
        slug: slug("acme-sso"),
        displayName: displayName("Acme SSO"),
        issuer: issuer("https://sso.acme.example"),
        scopes: ["openid", "email"],
      }),
      schema,
    );

    expect({ path: acme.path, template: acme.template, issuer: acme.issuer }).toEqual({
      path: `${IDPS}/acme-sso.json`,
      template: undefined,
      issuer: "https://sso.acme.example",
    });
  });

  it("points the connection at the issuer it was given instead of the provider's own", () => {
    const google = Connection.forProvider(idpProvider("google"), schema, {
      issuer: issuer("http://localhost:9100"),
    });

    expect(google.issuer).toBe("http://localhost:9100");
  });
});
