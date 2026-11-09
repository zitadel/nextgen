import { describe, expect, it } from "vitest";

import { CustomOidcProvider, idpProvider, type Scopes } from "@zitadel/config/idp";

import { ConflictError, Connection, UserSchema } from "@/lib/zitadel";
import {
  connectionNamed,
  existingConnection,
  sameIssuer,
  unappliedSettings,
} from "@/lib/zitadel/connections/lookup";
import { displayName, issuer, slug } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";

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

/** A google.json that has the slug but connects somewhere else. */
const localGoogle = connection("google.json", {
  slug: "google",
  oidc: { issuer: "http://localhost:9100", client_id: "a", client_secret: "b" },
});

describe("existingConnection for a catalog provider", () => {
  it("is nothing when the project has no connection to the provider", () => {
    expect(existingConnection([], google)).toBeUndefined();
  });

  it("is the connection the provider already has", () => {
    const existing = connection("google.json", googleBody());

    expect(existingConnection([existing], google)).toBe(existing);
  });

  it("recognises the provider by its slug and issuer when the template was removed", () => {
    const existing = connection("google.json", googleBody({ template: undefined }));

    expect(existingConnection([existing], google)).toBe(existing);
  });

  it("does not claim a connection of the developer's own that points at the provider's issuer", () => {
    const corp = connection("corp.json", {
      slug: "corp",
      oidc: {
        issuer: "https://accounts.google.com",
        client_id: "${{ CORP_CLIENT_ID }}",
        client_secret: "${{ CORP_CLIENT_SECRET }}",
      },
    });

    expect(existingConnection([corp], google)).toBeUndefined();
  });

  it("ignores connections to other providers", () => {
    const okta = connection("okta.json", {
      slug: "okta",
      template: "okta",
      oidc: { issuer: "https://acme.okta.com" },
    });

    expect(existingConnection([okta], google)).toBeUndefined();
  });

  it("does not mistake a connection for colliding with itself", () => {
    const only = connection("google.json", googleBody());

    expect(existingConnection([only], google)).toBe(only);
  });

  it("lets another connection use the variable a literal client id leaves unclaimed", () => {
    const literal = connection(
      "google.json",
      googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "824.apps.googleusercontent.com",
          client_secret: "${{ SOMETHING_ELSE }}",
        },
      }),
    );

    expect(existingConnection([literal], google)).toBe(literal);
  });

  it("reuses without complaint when the client id given is the one it holds", () => {
    const existing = connection("google.json", googleBody());

    expect(
      existingConnection([existing], google, { clientId: "111.apps.googleusercontent.com" }),
    ).toBe(existing);
  });

  it("refuses two connections to the provider, naming both", () => {
    const connections = [
      connection("google.json", googleBody()),
      connection("google-work.json", googleBody({ slug: "google_work" })),
    ];

    expect(() => {
      existingConnection(connections, google);
    }).toThrow(
      expect.objectContaining({
        name: "ConflictError",
        message: `More than one Google connection exists: ${IDPS}/google.json, ${IDPS}/google-work.json`,
      }),
    );
  });

  it("refuses a client id other than the one the connection holds", () => {
    const existing = connection("google.json", googleBody());

    expect(() => {
      existingConnection([existing], google, { clientId: "999.apps.googleusercontent.com" });
    }).toThrow(
      expect.objectContaining({
        name: "ConfigError",
        message: `${IDPS}/google.json already uses client id 111.apps.googleusercontent.com, not 999.apps.googleusercontent.com`,
      }),
    );
  });

  it("refuses a matched connection that declares no slug", () => {
    const { slug: _dropped, ...body } = googleBody();

    expect(() => {
      existingConnection([connection("google.json", body)], google);
    }).toThrow(
      expect.objectContaining({
        name: "ConfigError",
        message: `${IDPS}/google.json is a Google connection with no usable slug`,
      }),
    );
  });

  it("says a google.json that has the slug but another issuer is not a Google connection", () => {
    expect(() => {
      existingConnection([localGoogle], google);
    }).toThrow(/is a connection called google, but not to Google/);
  });

  it("points the refusal at the file and the schemas and flows, not at a flag", () => {
    const error = thrownBy(() => {
      existingConnection([localGoogle], google);
    });

    expect(error).toMatchObject({
      hint: expect.stringContaining("in the schemas and flows that name it"),
    });
  });

  it("names no flag in the refusal's hint", () => {
    const error = thrownBy(() => {
      existingConnection([localGoogle], google);
    });

    expect(error).toMatchObject({ hint: expect.not.stringContaining("--") });
  });

  it("refuses to overwrite an unrelated connection already called google.json", () => {
    const squatter = connection("google.json", {
      slug: "google",
      template: "okta",
      oidc: { issuer: "https://acme.okta.com" },
    });

    expect(() => {
      existingConnection([squatter], google);
    }).toThrow(
      expect.objectContaining({
        name: "ConflictError",
        message: expect.stringContaining("not to Google"),
      }),
    );
  });

  it("still checks the variables a file with an unusable slug references", () => {
    const okta = connection("okta.json", {
      slug: "Okta",
      oidc: {
        issuer: "https://acme.okta.com",
        client_id: "${{ OKTA_CLIENT_ID }}",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      },
    });

    expect(
      thrownBy(() => {
        existingConnection([okta], google);
      }),
    ).toBeInstanceOf(ConflictError);
  });

  it("refuses a new connection whose variable a hand-edited connection already uses", () => {
    const okta = connection("okta.json", {
      slug: "okta",
      template: "oidc-generic",
      oidc: {
        issuer: "https://acme.okta.com",
        client_id: "${{ OKTA_CLIENT_ID }}",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      },
    });

    expect(() => {
      existingConnection([okta], google);
    }).toThrow(`${IDPS}/okta.json and google both use GOOGLE_CLIENT_SECRET`);
  });

  it("refuses a reused connection whose variable another connection also uses", () => {
    const okta = connection("okta.json", {
      slug: "okta",
      oidc: {
        issuer: "https://acme.okta.com",
        client_id: "${{ OKTA_CLIENT_ID }}",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      },
    });

    expect(() => {
      existingConnection([connection("google.json", googleBody()), okta], google);
    }).toThrow(`${IDPS}/okta.json and google both use GOOGLE_CLIENT_SECRET`);
  });

  it("refuses a connection pointing both credentials at one variable", () => {
    const both = connection(
      "google.json",
      googleBody({
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ GOOGLE_CLIENT_SECRET }}",
          client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
        },
      }),
    );

    expect(() => {
      existingConnection([both], google);
    }).toThrow("This connection points both credentials at GOOGLE_CLIENT_SECRET");
  });
});

describe("existingConnection for a connection of the developer's own", () => {
  const acmeInput = {
    slug: slug("acme-sso"),
    displayName: displayName("Acme SSO"),
    issuer: issuer("https://sso.acme.example"),
    scopes: ["openid", "profile", "email"] as Scopes,
  };

  function custom(over: Partial<typeof acmeInput> = {}): Connection {
    return Connection.forProvider(new CustomOidcProvider({ ...acmeInput, ...over }), schema);
  }

  function acmeBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      slug: "acme-sso",
      protocol: "oidc",
      display_name: "Acme SSO",
      oidc: {
        issuer: "https://sso.acme.example",
        client_id: "${{ ACME_SSO_CLIENT_ID }}",
        client_secret: "${{ ACME_SSO_CLIENT_SECRET }}",
        scopes: ["openid", "profile", "email"],
      },
      ...over,
    };
  }

  const acmeOidc = acmeBody().oidc as Record<string, unknown>;

  it("is nothing when no connection has the slug", () => {
    expect(existingConnection([], custom())).toBeUndefined();
  });

  it("is nothing beside another connection to the same issuer under another slug", () => {
    const staff = connection(
      "acme-staff.json",
      acmeBody({
        slug: "acme-staff",
        oidc: {
          ...acmeOidc,
          client_id: "${{ ACME_STAFF_CLIENT_ID }}",
          client_secret: "${{ ACME_STAFF_CLIENT_SECRET }}",
        },
      }),
    );

    expect(existingConnection([staff], custom())).toBeUndefined();
  });

  it("is not confused by a catalog connection to the same issuer", () => {
    const candidate = custom({ issuer: issuer("https://accounts.google.com") });

    const existing = connection("google.json", googleBody());

    expect(existingConnection([existing], candidate)).toBeUndefined();
  });

  it("is the connection that already has the slug and issuer", () => {
    const existing = connection("acme-sso.json", acmeBody());

    expect(existingConnection([existing], custom())).toBe(existing);
  });

  it("finds the connection by its slug when the file was renamed", () => {
    const existing = connection("sso.json", acmeBody());

    expect(existingConnection([existing], custom())).toBe(existing);
  });

  it("finds the connection whose file spells the slug with spaces", () => {
    const existing = connection("acme-sso.json", acmeBody({ slug: " acme-sso " }));

    expect(existingConnection([existing], custom())).toBe(existing);
  });

  it("takes a trailing slash for a different issuer, as the server does", () => {
    const existing = connection("acme-sso.json", acmeBody());

    expect(
      thrownBy(() => {
        existingConnection([existing], custom({ issuer: issuer("https://sso.acme.example/") }));
      }),
    ).toBeInstanceOf(ConflictError);
  });

  it("refuses a slug that belongs to a connection to another issuer", () => {
    const existing = connection("acme-sso.json", acmeBody());

    expect(() => {
      existingConnection([existing], custom({ issuer: issuer("https://sso.other.example") }));
    }).toThrow(/already named acme-sso and connects to https:\/\/sso\.acme\.example/);
  });

  it("points a refused issuer at another slug, because an applied connection keeps its issuer", () => {
    const existing = connection("acme-sso.json", acmeBody());
    const error = thrownBy(() => {
      existingConnection([existing], custom({ issuer: issuer("https://sso.other.example") }));
    });

    expect(error).toMatchObject({ hint: expect.stringContaining("Choose another slug") });
  });

  it("refuses a slug that belongs to a connection without an oidc block", () => {
    const existing = connection("acme-sso.json", { slug: "acme-sso", protocol: "oidc" });

    expect(() => {
      existingConnection([existing], custom());
    }).toThrow(/not an OIDC connection/);
  });

  it("refuses an unrelated file already where the connection would go", () => {
    const occupied = connection("acme-sso.json", acmeBody({ slug: "something-else" }));

    expect(() => {
      existingConnection([occupied], custom());
    }).toThrow(`${IDPS}/acme-sso.json already exists and is not the acme-sso connection`);
  });

  it("asks for another slug, naming no flag, when the file name is taken", () => {
    const occupied = connection("acme-sso.json", acmeBody({ slug: "something-else" }));
    const error = thrownBy(() => {
      existingConnection([occupied], custom());
    });

    expect(error).toMatchObject({
      hint: "Rename or remove that file, or choose another slug, then run the command again.",
    });
  });

  it("refuses two files that claim the slug", () => {
    const connections = [connection("a.json", acmeBody()), connection("b.json", acmeBody())];

    expect(() => {
      existingConnection(connections, custom());
    }).toThrow(/More than one connection is named acme-sso/);
  });

  it("refuses a client id other than the literal one the connection holds", () => {
    const existing = connection(
      "acme-sso.json",
      acmeBody({ oidc: { ...acmeOidc, client_id: "literal-id" } }),
    );

    expect(() => {
      existingConnection([existing], custom(), { clientId: "another-id" });
    }).toThrow(/already uses client id literal-id/);
  });

  it("refuses a new slug whose derived variables another connection already uses", () => {
    // `acme_sso` and `acme-sso` both derive ACME_SSO_CLIENT_ID.
    const existing = connection("acme_sso.json", acmeBody({ slug: "acme_sso" }));

    expect(() => {
      existingConnection([existing], custom());
    }).toThrow(/both use ACME_SSO_CLIENT_ID/);
  });

  it("refuses to take over a variable a hand-edited connection points at", () => {
    const okta = connection(
      "okta.json",
      acmeBody({
        slug: "okta",
        oidc: {
          ...acmeOidc,
          client_id: "${{ OKTA_CLIENT_ID }}",
          client_secret: "${{ ACME_SSO_CLIENT_SECRET }}",
        },
      }),
    );

    expect(() => {
      existingConnection([okta], custom());
    }).toThrow(`${IDPS}/okta.json and acme-sso both use ACME_SSO_CLIENT_SECRET`);
  });

  it("reads the credentials a reused connection actually references", () => {
    const existing = connection(
      "acme-sso.json",
      acmeBody({ oidc: { ...acmeOidc, client_secret: "${{ ACME_SECRET }}" } }),
    );

    expect(existingConnection([existing], custom())?.credentialNames.clientSecret).toBe(
      "ACME_SECRET",
    );
  });
});

describe("connectionNamed", () => {
  const acme = connection("acme-sso.json", {
    slug: "acme-sso",
    display_name: "Acme SSO",
    oidc: { issuer: "https://sso.acme.example", scopes: ["openid", "email"] },
  });

  it("is the single connection that declares the slug", () => {
    expect(connectionNamed([acme], "acme-sso")).toBe(acme);
  });

  it("is nothing for a slug that is free", () => {
    expect(connectionNamed([acme], "other-sso")).toBeUndefined();
  });

  it("refuses two connections that declare the same slug", () => {
    const twin = connection("acme-sso-copy.json", acme.body);

    expect(() => {
      connectionNamed([acme, twin], "acme-sso");
    }).toThrow(
      expect.objectContaining({
        name: "ConflictError",
        message: `More than one connection is named acme-sso: ${IDPS}/acme-sso.json, ${IDPS}/acme-sso-copy.json`,
      }),
    );
  });

  it("accepts the issuer the connection was written with", () => {
    expect(connectionNamed([acme], "acme-sso", "https://sso.acme.example")).toBe(acme);
  });

  it("refuses another issuer, even one that differs by a trailing slash", () => {
    expect(() => {
      connectionNamed([acme], "acme-sso", "https://sso.acme.example/");
    }).toThrow(
      `${IDPS}/acme-sso.json is already named acme-sso and connects to https://sso.acme.example, not https://sso.acme.example/`,
    );
  });

  it("refuses a connection that has no issuer at all", () => {
    const bare = connection("acme-sso.json", { slug: "acme-sso" });

    expect(() => {
      connectionNamed([bare], "acme-sso", "https://a.example");
    }).toThrow(
      `${IDPS}/acme-sso.json is already named acme-sso and is not an OIDC connection to https://a.example`,
    );
  });

  it("states both issuers for a --json reader", () => {
    const error = thrownBy(() => {
      connectionNamed([acme], "acme-sso", "https://sso.other.example");
    });

    expect(error).toMatchObject({
      details: {
        file: `${IDPS}/acme-sso.json`,
        slug: "acme-sso",
        issuer: "https://sso.other.example",
        existing_issuer: "https://sso.acme.example",
      },
    });
  });
});

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

