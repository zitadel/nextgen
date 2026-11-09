import { describe, expect, it } from "vitest";

import { idpProvider } from "@zitadel/config/idp";

import {
  ConfigError,
  Connection,
  NotOidcConnectionError,
  UnusableSettingError,
} from "@/lib/zitadel";
import { BrokenFile } from "@/lib/zitadel/resources/broken";
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

describe("Connection.markRead", () => {
  it("marks a new connection as read", () => {
    const created = Connection.create(aFile("connections", "acme.json", anOidcConnection()));

    const read = created.markRead();

    expect(read.status).toBe("read");
  });
});

describe("Connection.check", () => {
  describe("with a connection the server would accept", () => {
    it("finds nothing wrong", () => {
      const acme = Connection.of(aFile("connections", "acme.json", anOidcConnection()));

      const issues = acme.check({});

      expect(issues).toEqual([]);
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

      const issues = partial.check({});

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

      const issues = typo.check({});

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
});

describe("Connection.read", () => {
  describe("with a connection the server would accept", () => {
    it("takes it as a connection", () => {
      const read = Connection.read(aFile("connections", "acme.json", anOidcConnection()));

      expect(read).toBeInstanceOf(Connection);
    });
  });

  describe("with a client secret held as a value", () => {
    const literal = aFile(
      "connections",
      "acme.json",
      anOidcConnection({ oidc: { client_secret: "a-literal-secret" } }),
    );

    it("takes it as a broken file", () => {
      const read = Connection.read(literal);

      expect(read).toBeInstanceOf(BrokenFile);
    });

    it("reports it once, as a literal secret, saying what to write instead", () => {
      const read = Connection.read(literal);

      expect(read).toMatchObject({
        issues: [
          {
            severity: "error",
            rule: "connection/literal-secret",
            file: ACME_FILE,
            message:
              'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
          },
        ],
      });
    });
  });

  describe("with a value the connection contract refuses", () => {
    it("reports it under contract/connection", () => {
      const read = Connection.read(
        aFile("connections", "acme.json", anOidcConnection({ protocol: "saml" })),
      );

      expect(read).toMatchObject({
        issues: [expect.objectContaining({ rule: "contract/connection" })],
      });
    });
  });

  describe("with a refused value and a field the contract does not have", () => {
    it("reports the field after the refusal", () => {
      const read = Connection.read(
        aFile(
          "connections",
          "acme.json",
          anOidcConnection({ protocol: "saml", display_nam: "Acme" }),
        ),
      );

      expect(read).toMatchObject({
        issues: [
          expect.objectContaining({ rule: "contract/connection" }),
          expect.objectContaining({ rule: "sso/unknown-connection-field" }),
        ],
      });
    });
  });
});

describe("Connection.toWireBody", () => {
  it("sends the connection without its $schema pointer", () => {
    const acme = Connection.of(
      aFile(
        "connections",
        "acme.json",
        anOidcConnection({ $schema: "../meta/idp-connection.json" }),
      ),
    );

    const body = acme.toWireBody(new MemoryStore());

    expect(body).toEqual(anOidcConnection());
  });
});

describe("Connection.credentials", () => {
  it.each([
    [
      "reads the variable each field references, not the one its slug implies",
      "okta.json",
      {
        slug: "okta",
        protocol: "oidc",
        display_name: "Okta",
        oidc: {
          issuer: "https://acme.okta.com",
          client_id: "${{ OKTA_CLIENT_ID }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
        },
      },
      {
        clientId: { kind: "variable", field: "client_id", variable: "OKTA_CLIENT_ID" },
        clientSecret: {
          kind: "variable",
          field: "client_secret",
          variable: "GOOGLE_CLIENT_SECRET",
        },
      },
    ],
    [
      "holds a client id the file holds as a value as that value",
      "google.json",
      {
        slug: "google",
        protocol: "oidc",
        display_name: "Google",
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "824.apps.googleusercontent.com",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
        },
      },
      {
        clientId: { kind: "literal", field: "client_id", value: "824.apps.googleusercontent.com" },
        clientSecret: {
          kind: "variable",
          field: "client_secret",
          variable: "GOOGLE_CLIENT_SECRET",
        },
      },
    ],
  ])("%s", (_claim, name, body, expected) => {
    const connection = Connection.of(aFile("connections", name, body));

    const credentials = connection.credentials;

    expect(credentials).toEqual(expected);
  });

  describe("when the file has no oidc block", () => {
    it("is nothing", () => {
      const bare = Connection.of(
        aFile("connections", "acme.json", { slug: "acme", protocol: "oidc", display_name: "Acme" }),
      );

      const credentials = bare.credentials;

      expect(credentials).toBeUndefined();
    });
  });
});

describe("Connection.displayName", () => {
  it("is the display name the file holds", () => {
    const acme = Connection.of(aFile("connections", "acme-sso.json", ACME_SSO));

    const name = acme.displayName;

    expect(name).toBe("Acme SSO");
  });
});

describe("Connection.issuer", () => {
  it("is the issuer the file holds", () => {
    const acme = Connection.of(aFile("connections", "acme-sso.json", ACME_SSO));

    const held = acme.issuer;

    expect(held).toBe("https://sso.acme.example");
  });

  describe("when the file has no oidc block", () => {
    it("is nothing", () => {
      const bare = Connection.of(
        aFile("connections", "acme-sso.json", {
          slug: "acme-sso",
          protocol: "oidc",
          display_name: "Acme SSO",
        }),
      );

      const held = bare.issuer;

      expect(held).toBeUndefined();
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

describe("Connection.listUnappliedSettings", () => {
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
      const settings = existing.listUnappliedSettings(candidate, given);

      expect(settings).toEqual(unapplied);
    });
  });

  describe("when the candidate differs in display name", () => {
    it("names the display name", () => {
      const candidate = Connection.of(
        aFile("connections", "acme-sso.json", { ...ACME_SSO, display_name: "New name" }),
      );

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

describe("Connection.refuseNonOidc", () => {
  describe("when the file has no issuer", () => {
    it("refuses it as no OIDC connection", () => {
      const acme = Connection.of(
        aFile("connections", "acme-sso.json", {
          slug: "acme-sso",
          protocol: "oidc",
          display_name: "Acme",
        }),
      );

      const error = thrownBy(() => {
        return acme.refuseNonOidc();
      });

      expect(error).toBeInstanceOf(NotOidcConnectionError);
    });
  });
});

describe("Connection.readUsableDisplayName", () => {
  describe("when the platform would not take it", () => {
    it("refuses it, naming the file", () => {
      const acme = Connection.of(
        aFile(
          "connections",
          "acme-sso.json",
          anOidcConnection({ slug: "acme-sso", display_name: "   " }),
        ),
      );

      const error = thrownBy(() => {
        return acme.readUsableDisplayName();
      });

      expect(error).toBeInstanceOf(UnusableSettingError);
      expect(error).toMatchObject({ details: { file: ACME_SSO_FILE, slug: "acme-sso" } });
    });
  });
});

describe("Connection.readUsableIssuer", () => {
  it("is the issuer the file holds", () => {
    const acme = Connection.of(
      aFile("connections", "acme-sso.json", anOidcConnection({ slug: "acme-sso" })),
    );

    const stored = acme.readUsableIssuer();

    expect(stored).toBe("https://sso.acme.example");
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
