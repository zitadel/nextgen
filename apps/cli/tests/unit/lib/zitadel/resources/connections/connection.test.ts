import { describe, expect, it } from "vitest";

import { CustomOidcProvider, idpProvider } from "@zitadel/config/idp";

import { ConfigError, ConflictError, Connection, UserSchema } from "@/lib/zitadel";
import type { Issue } from "@/lib/zitadel/rules/types";
import { MemoryStore } from "@/lib/zitadel/storage";
import { displayName, issuer, slug } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";
import { toJsonObject } from "@/lib/zitadel/utils/json";

/**
 * The directory connections sit in.
 */
const IDPS = ".zitadel/idps";

/**
 * The schema new connections fill.
 */
const schema = UserSchema.of({
  path: ".zitadel/schemas/customers.json",
  body: { objectType: "customers", properties: { email: { type: "string" } } },
});

/**
 * A connection the server would accept: its secret is a `${{ NAME }}` reference.
 */
const SOUND = {
  slug: "acme",
  protocol: "oidc",
  display_name: "Acme",
  oidc: {
    issuer: "https://sso.acme.example",
    client_id: "client",
    client_secret: "${{ ACME_CLIENT_SECRET }}",
    scopes: ["openid"],
  },
};

/**
 * A connection read from `.zitadel/idps/`.
 *
 * @param name - The file's name.
 * @param body - What it holds.
 * @returns The connection, as read.
 */
function connection(name: string, body: Record<string, unknown>): Connection {
  const read = toJsonObject(JSON.parse(JSON.stringify(body)), name);
  return Connection.of({ path: `${IDPS}/${name}`, body: read });
}

/**
 * The rules some findings break, in order.
 *
 * @param issues - The findings.
 * @returns Each finding's rule.
 */
function rulesOf(issues: readonly Issue[]): readonly string[] {
  return issues.map((issue) => {
    return issue.rule;
  });
}

describe("Connection.of", () => {
  it("takes the file as read", () => {
    expect(connection("acme.json", SOUND).status).toBe("read");
  });
});

describe("Connection.create", () => {
  it("takes the file as new", () => {
    expect(Connection.create({ path: `${IDPS}/acme.json`, body: SOUND }).status).toBe("created");
  });
});

describe("Connection.asRead", () => {
  it("marks a new connection as read", () => {
    expect(Connection.create({ path: `${IDPS}/acme.json`, body: SOUND }).markRead().status).toBe(
      "read",
    );
  });
});

describe("Connection.problems", () => {
  it("finds nothing wrong with a connection the server would accept", () => {
    expect(connection("acme.json", SOUND).check({})).toEqual([]);
  });

  it("reports a secret held as a value once, as a literal secret", () => {
    const literal = connection("acme.json", {
      ...SOUND,
      oidc: { ...SOUND.oidc, client_secret: "a-literal-secret" },
    });

    expect(rulesOf(literal.check({}))).toEqual(["connection/literal-secret"]);
  });

  it("tells a literal secret what to write instead", () => {
    const literal = connection("acme.json", {
      ...SOUND,
      oidc: { ...SOUND.oidc, client_secret: "a-literal-secret" },
    });

    expect(literal.check({})).toEqual([
      {
        severity: "error",
        rule: "connection/literal-secret",
        file: `${IDPS}/acme.json`,
        message:
          'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
      },
    ]);
  });

  it("names the endpoints an oidc block that names some of them leaves out", () => {
    const partial = connection("acme.json", {
      ...SOUND,
      oidc: { ...SOUND.oidc, authorization_endpoint: "https://sso.acme.example/authorize" },
    });

    expect(
      partial.check({}).map((issue) => {
        return [issue.rule, issue.message.split(".")[0]];
      }),
    ).toEqual([
      [
        "connection/endpoints",
        "oidc names some endpoints but not jwks_uri, token_endpoint, userinfo_endpoint",
      ],
    ]);
  });

  it("names a field the contract does not have, with what it most likely meant", () => {
    const typo = connection("acme.json", { ...SOUND, display_nam: "Acme" });

    expect(
      typo.check({}).filter((issue) => {
        return issue.rule === "sso/unknown-connection-field";
      }),
    ).toEqual([
      {
        severity: "error",
        rule: "sso/unknown-connection-field",
        file: `${IDPS}/acme.json`,
        message: expect.stringMatching(
          /^"display_nam" is not a field of a connection, so it is ignored or refused\. Did you mean "display_name"\?/,
        ),
      },
    ]);
  });

  it("reports what the connection contract refuses, under contract/connection", () => {
    const broken = connection("acme.json", { ...SOUND, protocol: "saml" });

    expect(rulesOf(broken.check({}))).toEqual(["contract/connection"]);
  });
});

describe("Connection.wireBody", () => {
  it("sends the connection without its $schema pointer", () => {
    const acme = connection("acme.json", { $schema: "../meta/idp-connection.json", ...SOUND });

    expect(acme.toWireBody(new MemoryStore())).toEqual(SOUND);
  });
});

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

describe("Connection.listUnappliedSettings", () => {
  const existing = connection("acme-sso.json", {
    slug: "acme-sso",
    display_name: "Acme SSO",
    oidc: { issuer: "https://sso.acme.example", scopes: ["openid", "profile", "email"] },
  });

  describe("when the candidate differs in scopes", () => {
    const candidate = connection("acme-sso.json", {
      slug: "acme-sso",
      display_name: "Acme SSO",
      oidc: { issuer: "https://sso.acme.example", scopes: ["openid", "groups"] },
    });

    it.each([
      ["names them when they were given", ["scopes"], ["scopes"]],
      ["says nothing when they were not given", [], []],
    ] as const)("%s", (_claim, given, unapplied) => {
      expect(existing.listUnappliedSettings(candidate, given)).toEqual(unapplied);
    });
  });

  describe("when the candidate differs in display name", () => {
    it("names the display name", () => {
      const candidate = connection("acme-sso.json", {
        slug: "acme-sso",
        display_name: "New name",
        oidc: { issuer: "https://sso.acme.example", scopes: ["openid", "profile", "email"] },
      });

      const unapplied = existing.listUnappliedSettings(candidate, ["display name", "scopes"]);

      expect(unapplied).toEqual(["display name"]);
    });
  });

  describe("when the candidate has what the file already has", () => {
    it("names nothing", () => {
      const unapplied = existing.listUnappliedSettings(existing, ["display name", "scopes"]);

      expect(unapplied).toEqual([]);
    });
  });
});

describe("Connection.refuseDifferentClientId", () => {
  describe("when the file holds another client id as a value", () => {
    it("refuses with the stored and the given id", () => {
      const acme = connection("acme.json", SOUND);

      const refusal = (): void => {
        acme.refuseDifferentClientId("other");
      };

      expect(refusal).toThrow(ConfigError);
      expect(refusal).toThrow(`${IDPS}/acme.json already uses client id client, not other`);
    });
  });

  describe("when the file references a variable", () => {
    it("accepts any client id", () => {
      const acme = connection("acme.json", {
        ...SOUND,
        oidc: { ...SOUND.oidc, client_id: "${{ ACME_CLIENT_ID }}" },
      });

      expect(() => {
        acme.refuseDifferentClientId("other");
      }).not.toThrow();
    });
  });
});

describe("Connection.readStoredSettings", () => {
  it("is the display name and issuer the file holds", () => {
    const acme = connection("acme-sso.json", { ...SOUND, slug: "acme-sso" });

    const stored = acme.readStoredSettings({});

    expect(stored).toEqual({ displayName: "Acme", issuer: "https://sso.acme.example" });
  });

  describe("when the run was given a setting", () => {
    it("leaves it out without reading the file's", () => {
      const acme = connection("acme-sso.json", { ...SOUND, slug: "acme-sso", display_name: "   " });

      const stored = acme.readStoredSettings({ displayName: "Acme SSO" });

      expect(stored).toEqual({ displayName: undefined, issuer: "https://sso.acme.example" });
    });
  });

  describe("when the file does not hold a setting", () => {
    it("leaves it out", () => {
      const acme = connection("acme-sso.json", {
        ...SOUND,
        slug: "acme-sso",
        display_name: undefined,
      });

      const stored = acme.readStoredSettings({});

      expect(stored.displayName).toBeUndefined();
    });
  });

  describe("when a stored setting cannot be used", () => {
    it.each([
      ["a display name", { display_name: "   " }],
      ["an issuer", { oidc: { issuer: "not a url" } }],
    ])("refuses %s a typed answer could not be, naming the file", (what, over) => {
      const acme = connection("acme-sso.json", { ...SOUND, slug: "acme-sso", ...over });

      const error = thrownBy(() => {
        return acme.readStoredSettings({});
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: expect.stringContaining(
          `${IDPS}/acme-sso.json holds ${what} that cannot be used: `,
        ),
        hint: "Fix it in that file, or choose another slug.",
        details: { file: `${IDPS}/acme-sso.json`, slug: "acme-sso" },
      });
    });
  });

  describe("when the file has no issuer", () => {
    it("refuses it as no OIDC connection, whatever issuer was given", () => {
      const acme = connection("acme-sso.json", { ...SOUND, slug: "acme-sso", oidc: {} });

      const error = thrownBy(() => {
        return acme.readStoredSettings({ issuer: "https://sso.acme.example" });
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        message: `${IDPS}/acme-sso.json is already named acme-sso and is not an OIDC connection`,
        hint: "Fix the file, or choose another slug, then run the command again.",
      });
    });
  });
});

describe("Connection.mappingSummary", () => {
  describe("with nothing verified", () => {
    it("says so after the mappings", () => {
      const acme = connection("acme.json", { ...SOUND, claim_mapping: { email: "email" } });

      expect(acme.mappingSummary.split("\n").slice(1)).toEqual([
        "  email ← email",
        "Nothing is treated as verified.",
        "Edit the mappings in that file if your provider returns other claims.",
      ]);
    });
  });
});

describe("Connection.withEndpoints", () => {
  it("points the connection at the issuer it is given, as the provider would write it", () => {
    const google = Connection.forProvider(idpProvider("google"), schema);

    const pointed = google.withEndpoints({ issuer: issuer("http://localhost:9100") });

    expect(pointed.document.body).toEqual(
      Connection.forProvider(idpProvider("google"), schema, {
        issuer: issuer("http://localhost:9100"),
      }).body,
    );
  });

  it("keeps a new connection new, so saving it never replaces a file", () => {
    const google = Connection.forProvider(idpProvider("google"), schema);

    const pointed = google.withEndpoints({ issuer: issuer("http://localhost:9100") });

    expect(pointed.document.status).toBe("created");
  });

  describe("without an issuer", () => {
    it("leaves the connection as it is", () => {
      const google = Connection.forProvider(idpProvider("google"), schema);

      const pointed = google.withEndpoints({});

      expect(pointed).toEqual({ document: google, changed: false, skipped: [] });
    });
  });
});
