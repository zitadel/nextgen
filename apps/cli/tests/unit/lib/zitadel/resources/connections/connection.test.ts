import { describe, expect, it } from "vitest";

import { idpProvider } from "@zitadel/config/idp";

import { ConfigError, ConflictError, Connection } from "@/lib/zitadel";
import { MemoryStore } from "@/lib/zitadel/storage";
import { aFile, anOidcConnection } from "@tests/helpers/config";
import { anAcmeSsoProvider, CUSTOMERS_SCHEMA } from "@tests/helpers/connections";
import { issuer } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The directory connections sit in.
 */
const IDPS = ".zitadel/idps";

/**
 * The file the default `acme` connection is read from.
 */
const ACME_FILE = `${IDPS}/acme.json`;

/**
 * The file the `acme-sso` connection is read from.
 */
const ACME_SSO_FILE = `${IDPS}/acme-sso.json`;

/**
 * The issuer a connection is pointed at instead of the provider's own.
 */
const LOCAL_ISSUER = "http://localhost:9100";

/**
 * The `acme-sso` connection as the file holds it: openid, profile and email.
 */
const ACME_SSO = anOidcConnection({
  slug: "acme-sso",
  display_name: "Acme SSO",
  oidc: { scopes: ["openid", "profile", "email"] },
});

describe("Connection.of", () => {
  it("takes the file as read", () => {
    const connection = Connection.of(aFile("connections", "acme.json", anOidcConnection()));

    expect(connection.status).toBe("read");
  });
});

describe("Connection.create", () => {
  it("takes the file as new", () => {
    const connection = Connection.create(aFile("connections", "acme.json", anOidcConnection()));

    expect(connection.status).toBe("created");
  });
});

describe("Connection.asRead", () => {
  it("marks a new connection as read", () => {
    const created = Connection.create(aFile("connections", "acme.json", anOidcConnection()));

    const read = created.asRead();

    expect(read.status).toBe("read");
  });
});

describe("Connection.problems", () => {
  describe("with a connection the server would accept", () => {
    it("finds nothing wrong", () => {
      const acme = Connection.of(aFile("connections", "acme.json", anOidcConnection()));

      const issues = acme.problems({});

      expect(issues).toEqual([]);
    });
  });

  describe("with a client secret held as a value", () => {
    const literal = Connection.of(
      aFile(
        "connections",
        "acme.json",
        anOidcConnection({ oidc: { client_secret: "a-literal-secret" } }),
      ),
    );

    it("reports it once, as a literal secret", () => {
      const issues = literal.problems({});

      expect(issues).toEqual([expect.objectContaining({ rule: "connection/literal-secret" })]);
    });

    it("says what to write instead", () => {
      const issues = literal.problems({});

      expect(issues).toEqual([
        {
          severity: "error",
          rule: "connection/literal-secret",
          file: ACME_FILE,
          message:
            'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
        },
      ]);
    });
  });

  describe("with an oidc block that names only some endpoints", () => {
    it("names the endpoints it leaves out", () => {
      const partial = Connection.of(
        aFile(
          "connections",
          "acme.json",
          anOidcConnection({
            oidc: { authorization_endpoint: "https://sso.acme.example/authorize" },
          }),
        ),
      );

      const issues = partial.problems({});

      expect(issues).toEqual([
        expect.objectContaining({
          rule: "connection/endpoints",
          message: expect.stringMatching(
            /^oidc names some endpoints but not jwks_uri, token_endpoint, userinfo_endpoint\./,
          ),
        }),
      ]);
    });
  });

  describe("with a field the contract does not have", () => {
    it("names it, with what it most likely meant", () => {
      const typo = Connection.of(
        aFile("connections", "acme.json", anOidcConnection({ display_nam: "Acme" })),
      );

      const issues = typo.problems({});

      expect(issues).toContainEqual({
        severity: "error",
        rule: "sso/unknown-connection-field",
        file: ACME_FILE,
        message: expect.stringMatching(
          /^"display_nam" is not a field of a connection, so it is ignored or refused\. Did you mean "display_name"\?/,
        ),
      });
    });
  });

  describe("with a value the connection contract refuses", () => {
    it("reports it under contract/connection", () => {
      const broken = Connection.of(
        aFile("connections", "acme.json", anOidcConnection({ protocol: "saml" })),
      );

      const issues = broken.problems({});

      expect(issues).toEqual([expect.objectContaining({ rule: "contract/connection" })]);
    });
  });
});

describe("Connection.wireBody", () => {
  it("sends the connection without its $schema pointer", () => {
    const acme = Connection.of(
      aFile(
        "connections",
        "acme.json",
        anOidcConnection({ $schema: "../meta/idp-connection.json" }),
      ),
    );

    const body = acme.wireBody(new MemoryStore());

    expect(body).toEqual(anOidcConnection());
  });
});

describe("Connection.credentialNames", () => {
  it.each([
    [
      "names no variable for a connection with no usable slug and no references",
      "x.json",
      { oidc: { issuer: "https://x.example" } },
      { clientId: undefined, clientSecret: undefined },
    ],
    [
      "derives the variables from the slug for a field the file leaves out",
      "acme.json",
      { slug: "acme", oidc: { issuer: "https://x.example" } },
      { clientId: "ACME_CLIENT_ID", clientSecret: "ACME_CLIENT_SECRET" },
    ],
    [
      "reads the variable a field references, not the one its slug implies",
      "okta.json",
      {
        slug: "okta",
        oidc: {
          issuer: "https://acme.okta.com",
          client_id: "${{ OKTA_CLIENT_ID }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
        },
      },
      { clientId: "OKTA_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" },
    ],
    [
      "names no variable for a client id the file holds as a value",
      "google.json",
      {
        slug: "google",
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "824.apps.googleusercontent.com",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
        },
      },
      { clientId: undefined, clientSecret: "GOOGLE_CLIENT_SECRET" },
    ],
  ])("%s", (_claim, name, body, names) => {
    const connection = Connection.of(aFile("connections", name, body));

    const credentialNames = connection.credentialNames;

    expect(credentialNames).toEqual(names);
  });
});

describe("Connection.variableNames", () => {
  it("lists only the variables it names", () => {
    const literal = Connection.of(
      aFile("connections", "google.json", {
        slug: "google",
        oidc: { client_id: "824.apps.googleusercontent.com" },
      }),
    );

    const names = literal.variableNames;

    expect(names).toEqual(["GOOGLE_CLIENT_SECRET"]);
  });
});

describe("Connection.displayName", () => {
  it("is the display name the file holds", () => {
    const acme = Connection.of(aFile("connections", "acme-sso.json", ACME_SSO));

    const name = acme.displayName;

    expect(name).toBe("Acme SSO");
  });

  describe("when the file leaves it out", () => {
    it("is nothing", () => {
      const bare = Connection.of(aFile("connections", "acme-sso.json", { slug: "acme-sso" }));

      const name = bare.displayName;

      expect(name).toBeUndefined();
    });
  });
});

describe("Connection.issuer", () => {
  it("is the issuer the file holds", () => {
    const acme = Connection.of(aFile("connections", "acme-sso.json", ACME_SSO));

    const held = acme.issuer;

    expect(held).toBe("https://sso.acme.example");
  });

  describe("when the file holds it as something other than text", () => {
    it("is nothing", () => {
      const odd = Connection.of(
        aFile("connections", "acme-sso.json", { slug: "acme-sso", oidc: { issuer: 3 } }),
      );

      const held = odd.issuer;

      expect(held).toBeUndefined();
    });
  });
});

describe("Connection.name", () => {
  describe("when the file has no slug", () => {
    it("is the file name", () => {
      const okta = Connection.of(aFile("connections", "okta.json", {}));

      const name = okta.name;

      expect(name).toBe("okta");
    });
  });
});

describe("Connection.validSlug", () => {
  describe("when the slug is malformed", () => {
    it("is nothing", () => {
      const okta = Connection.of(aFile("connections", "okta.json", { slug: "Okta" }));

      const valid = okta.validSlug;

      expect(valid).toBeUndefined();
    });
  });
});

describe("Connection.declares", () => {
  describe("when the file spells the slug with spaces", () => {
    it("still declares it", () => {
      const acme = Connection.of(aFile("connections", "acme-sso.json", { slug: " acme-sso " }));

      const declared = acme.declares("acme-sso");

      expect(declared).toBe(true);
    });
  });
});

describe("Connection.forProvider", () => {
  describe("with a catalog provider", () => {
    it("writes it to the file its slug names, as a new file", () => {
      const google = Connection.forProvider(idpProvider("google"), CUSTOMERS_SCHEMA);

      expect({ path: google.path, status: google.status, template: google.template }).toEqual({
        path: `${IDPS}/google.json`,
        status: "created",
        template: "google",
      });
    });

    it("maps only the properties the schema defines", () => {
      const google = Connection.forProvider(idpProvider("google"), CUSTOMERS_SCHEMA);

      expect(
        google.mappings.map((row) => {
          return row.property;
        }),
      ).toEqual(["email"]);
    });
  });

  describe("with a provider of the developer's own", () => {
    it("writes it with no template, named after its slug", () => {
      const acme = Connection.forProvider(anAcmeSsoProvider(), CUSTOMERS_SCHEMA);

      expect({ path: acme.path, template: acme.template, issuer: acme.issuer }).toEqual({
        path: ACME_SSO_FILE,
        template: undefined,
        issuer: "https://sso.acme.example",
      });
    });
  });

  describe("with an issuer", () => {
    it("points the connection at it instead of the provider's own", () => {
      const google = Connection.forProvider(idpProvider("google"), CUSTOMERS_SCHEMA, {
        issuer: issuer(LOCAL_ISSUER),
      });

      expect(google.issuer).toBe(LOCAL_ISSUER);
    });
  });
});

describe("Connection.unappliedSettings", () => {
  const existing = Connection.of(aFile("connections", "acme-sso.json", ACME_SSO));

  describe("when the candidate differs in scopes", () => {
    const candidate = Connection.of(
      aFile(
        "connections",
        "acme-sso.json",
        anOidcConnection({
          slug: "acme-sso",
          display_name: "Acme SSO",
          oidc: { scopes: ["openid", "groups"] },
        }),
      ),
    );

    it.each([
      ["names them when they were given", ["scopes"], ["scopes"]],
      ["says nothing when they were not given", [], []],
    ] as const)("%s", (_claim, given, unapplied) => {
      const settings = existing.unappliedSettings(candidate, given);

      expect(settings).toEqual(unapplied);
    });
  });

  describe("when the candidate differs in display name", () => {
    it("names the display name", () => {
      const candidate = Connection.of(
        aFile("connections", "acme-sso.json", { ...ACME_SSO, display_name: "New name" }),
      );

      const unapplied = existing.unappliedSettings(candidate, ["display name", "scopes"]);

      expect(unapplied).toEqual(["display name"]);
    });
  });

  describe("when the candidate has what the file already has", () => {
    it("names nothing", () => {
      const unapplied = existing.unappliedSettings(existing, ["display name", "scopes"]);

      expect(unapplied).toEqual([]);
    });
  });
});

describe("Connection.refuseDifferentClientId", () => {
  describe("when the file holds another client id as a value", () => {
    it("refuses with the stored and the given id", () => {
      const acme = Connection.of(aFile("connections", "acme.json", anOidcConnection()));

      const error = thrownBy(() => {
        return acme.refuseDifferentClientId("other");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: `${ACME_FILE} already uses client id client, not other`,
      });
    });
  });

  describe("when the file references a variable", () => {
    it("accepts any client id", () => {
      const acme = Connection.of(
        aFile(
          "connections",
          "acme.json",
          anOidcConnection({ oidc: { client_id: "${{ ACME_CLIENT_ID }}" } }),
        ),
      );

      const error = thrownBy(() => {
        return acme.refuseDifferentClientId("other");
      });

      expect(error).toBeUndefined();
    });
  });
});

describe("Connection.storedSettings", () => {
  it("is the display name and issuer the file holds", () => {
    const acme = Connection.of(
      aFile("connections", "acme-sso.json", anOidcConnection({ slug: "acme-sso" })),
    );

    const stored = acme.storedSettings({});

    expect(stored).toEqual({ displayName: "Acme", issuer: "https://sso.acme.example" });
  });

  describe("when the run was given a setting", () => {
    it("leaves it out without reading the file's", () => {
      const acme = Connection.of(
        aFile(
          "connections",
          "acme-sso.json",
          anOidcConnection({ slug: "acme-sso", display_name: "   " }),
        ),
      );

      const stored = acme.storedSettings({ displayName: "Acme SSO" });

      expect(stored).toEqual({ displayName: undefined, issuer: "https://sso.acme.example" });
    });
  });

  describe("when the file does not hold a setting", () => {
    it("leaves it out", () => {
      const acme = Connection.of(
        aFile(
          "connections",
          "acme-sso.json",
          anOidcConnection({ slug: "acme-sso", display_name: undefined }),
        ),
      );

      const stored = acme.storedSettings({});

      expect(stored.displayName).toBeUndefined();
    });
  });

  describe("when a stored setting cannot be used", () => {
    it.each([
      ["a display name", { display_name: "   " }],
      ["an issuer", { oidc: { issuer: "not a url" } }],
    ])("refuses %s a typed answer could not be, naming the file", (what, overrides) => {
      const acme = Connection.of(
        aFile("connections", "acme-sso.json", anOidcConnection({ slug: "acme-sso", ...overrides })),
      );

      const error = thrownBy(() => {
        return acme.storedSettings({});
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: expect.stringContaining(`${ACME_SSO_FILE} holds ${what} that cannot be used: `),
        hint: "Fix it in that file, or choose another slug.",
        details: { file: ACME_SSO_FILE, slug: "acme-sso" },
      });
    });
  });

  describe("when the file has no issuer", () => {
    it("refuses it as no OIDC connection, whatever issuer was given", () => {
      const acme = Connection.of(
        aFile("connections", "acme-sso.json", {
          ...anOidcConnection({ slug: "acme-sso" }),
          oidc: {},
        }),
      );

      const error = thrownBy(() => {
        return acme.storedSettings({ issuer: "https://sso.acme.example" });
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        message: `${ACME_SSO_FILE} is already named acme-sso and is not an OIDC connection`,
        hint: "Fix the file, or choose another slug, then run the command again.",
      });
    });
  });
});

describe("Connection.mappingSummary", () => {
  describe("with nothing verified", () => {
    it("says so after the mappings", () => {
      const acme = Connection.of(
        aFile("connections", "acme.json", anOidcConnection({ claim_mapping: { email: "email" } })),
      );

      const summary = acme.mappingSummary;

      expect(summary.split("\n").slice(1)).toEqual([
        "  email ← email",
        "Nothing is treated as verified.",
        "Edit the mappings in that file if your provider returns other claims.",
      ]);
    });
  });
});

describe("Connection.withEndpoints", () => {
  const google = Connection.forProvider(idpProvider("google"), CUSTOMERS_SCHEMA);

  describe("with an issuer", () => {
    it("points the connection at it, as the provider would write it", () => {
      const pointed = google.withEndpoints({ issuer: issuer(LOCAL_ISSUER) });

      expect(pointed.document.body).toEqual(
        Connection.forProvider(idpProvider("google"), CUSTOMERS_SCHEMA, {
          issuer: issuer(LOCAL_ISSUER),
        }).body,
      );
    });

    it("keeps a new connection new, so saving it never replaces a file", () => {
      const pointed = google.withEndpoints({ issuer: issuer(LOCAL_ISSUER) });

      expect(pointed.document.status).toBe("created");
    });
  });

  describe("without an issuer", () => {
    it("leaves the connection as it is", () => {
      const pointed = google.withEndpoints({});

      expect(pointed).toEqual({ document: google, changed: false, skipped: [] });
    });
  });
});
