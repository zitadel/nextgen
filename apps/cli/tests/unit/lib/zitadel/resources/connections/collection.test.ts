import { describe, expect, it } from "vitest";

import {
  CustomOidcProvider,
  idpProvider,
  parseClientId,
  type Scopes,
  validated,
} from "@zitadel/config/idp";

import {
  ConflictError,
  Connection,
  type Connections,
  type JsonObject,
  NoSignInLeftError,
  NotFoundError,
  RefusedEditError,
  UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import { displayName, issuer, slug } from "@tests/helpers/idp-values";
import { loginFlow } from "@tests/helpers/local-project";
import { thrownBy } from "@tests/helpers/thrown-value";
import { toJsonObject } from "@/lib/zitadel/utils/json";

const SCHEMA = ".zitadel/schemas/customers.json";
const FLOW = ".zitadel/flows/customers-login.json";
const IDPS = ".zitadel/idps";

type Entry = Readonly<{ path: string; body: Record<string, unknown> }>;

/**
 * A fixture body as a file holds it: written and read back as JSON, so a key
 * set to `undefined` is left out, as a file leaves it out.
 *
 * @param body - The fixture body.
 * @returns The body as read.
 */
function asRead(body: Record<string, unknown>): JsonObject {
  return toJsonObject(JSON.parse(JSON.stringify(body)), "fixture");
}

/**
 * Fixture entries as the configuration takes its files.
 *
 * @param entries - The fixture entries.
 * @returns Each entry with its body as read.
 */
function filesOf(entries: readonly Entry[]): readonly { path: string; body: JsonObject }[] {
  return entries.map((entry) => {
    return { path: entry.path, body: asRead(entry.body) };
  });
}

/** The customers schema, signing in with a password, with these `x-auth-methods` on top. */
function customers(methods: Record<string, unknown> = {}): Entry {
  return {
    path: SCHEMA,
    body: {
      objectType: "customers",
      properties: { email: { type: "string" } },
      "x-auth-methods": { password: { enabled: true }, ...methods },
    },
  };
}

/** The scaffolded login flow, run against the customers schema. */
function customersLogin(over: Record<string, unknown> = {}): Entry {
  return { path: FLOW, body: { ...loginFlow("customers"), user_schema: "customers", ...over } };
}

function configOf(input: {
  schemas?: readonly Entry[];
  flows?: readonly Entry[];
  connections?: readonly Entry[];
}): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: filesOf(input.schemas ?? [customers()]),
    flows: filesOf(input.flows ?? [customersLogin()]),
    connections: filesOf(input.connections ?? []),
    policies: [],
    branding: [],
  });
}

function schemaOf(config: ZitadelConfig): UserSchema {
  const schema = config.schemas.get(SCHEMA);
  if (schema === undefined) {
    throw new Error(`the configuration has no ${SCHEMA}`);
  }
  return schema;
}

function googleFor(config: ZitadelConfig): Connection {
  return Connection.forProvider(idpProvider("google"), schemaOf(config));
}

function messages(notices: readonly { message: string }[]): string[] {
  return notices.map((notice) => {
    return notice.message;
  });
}

/** A Google connection already in the project. */
const googleFile: Entry = {
  path: `${IDPS}/google.json`,
  body: {
    slug: "google",
    protocol: "oidc",
    template: "google",
    display_name: "Google",
    claim_mapping: { email: "email" },
    oidc: {
      issuer: "https://accounts.google.com",
      client_id: "${{ GOOGLE_CLIENT_ID }}",
      client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      scopes: ["openid", "profile", "email"],
    },
  },
};

/** A schema the catalog connections are written against. */
const schema = UserSchema.of({
  path: ".zitadel/schemas/customers.json",
  body: { objectType: "customers", properties: { email: { type: "string" } } },
});

const google = Connection.forProvider(idpProvider("google"), schema);

function connection(name: string, body: Record<string, unknown>): Connection {
  return Connection.of({ path: `${IDPS}/${name}`, body: asRead(body) });
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

/** The project's connections, as a configuration holds them. */
function connectionsOf(connections: readonly Connection[]): Connections {
  return ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: connections.map((entry) => {
      return entry.file;
    }),
    policies: [],
    branding: [],
  }).connections;
}

describe("Connections.enable", () => {
  it("creates the connection when the project has none for the provider", () => {
    const config = configOf({});

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.createdPaths).toEqual([`${IDPS}/google.json`]);
  });

  it("reuses the connection the project already has", () => {
    const config = configOf({ connections: [googleFile] });

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.changedPaths).toEqual([SCHEMA, FLOW]);
  });

  it("is about the connection it creates", () => {
    const config = configOf({});

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect({ path: change.document.path, created: change.created }).toEqual({
      path: `${IDPS}/google.json`,
      created: true,
    });
  });

  it("is about the connection it reuses, which it does not create", () => {
    const config = configOf({ connections: [googleFile] });

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect({ document: change.document, created: change.created }).toEqual({
      document: config.connections.find("google"),
      created: false,
    });
  });

  it("lists the provider in the schema", () => {
    const config = configOf({});

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.after.schemas.get(SCHEMA)?.providers).toEqual(["google"]);
  });

  it("offers the provider on every flow that runs against the schema", () => {
    const config = configOf({});

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(
      change.after.flows.all.map((flow) => {
        return flow.offers("google");
      }),
    ).toEqual([true]);
  });

  it("refuses a schema no login flow runs against", () => {
    const config = configOf({ flows: [] });

    expect(
      thrownBy(() => {
        config.connections.enable(schemaOf(config), googleFor(config));
      }),
    ).toBeInstanceOf(NotFoundError);
  });

  it("says nothing more for a new catalog connection that maps the schema", () => {
    const config = configOf({});

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.notices).toEqual([]);
  });

  it("says when another connection already reaches the provider's issuer under another slug", () => {
    const work: Entry = {
      path: `${IDPS}/google-work.json`,
      body: {
        slug: "google-work",
        protocol: "oidc",
        claim_mapping: { email: "email" },
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ WORK_CLIENT_ID }}",
          client_secret: "${{ WORK_CLIENT_SECRET }}",
        },
      },
    };
    const config = configOf({ connections: [work] });

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message: `${IDPS}/google-work.json already connects to Google's issuer under another slug, so this adds a second Google connection and button.`,
    });
  });

  it("says a setting given for a reused connection was not applied", () => {
    const config = configOf({
      connections: [{ ...googleFile, body: { ...googleFile.body, display_name: "Old name" } }],
    });

    const change = config.connections.enable(schemaOf(config), googleFor(config), {
      given: ["display name"],
    });

    expect(change.notices).toEqual([
      {
        severity: "warning",
        message: `${IDPS}/google.json already exists, so the display name you gave was not applied. Edit the file to change it.`,
      },
    ]);
  });

  it("says every setting given for a reused connection that was not applied", () => {
    const config = configOf({
      connections: [
        {
          ...googleFile,
          body: {
            ...googleFile.body,
            display_name: "Old name",
            oidc: { ...(googleFile.body.oidc as object), scopes: ["openid"] },
          },
        },
      ],
    });

    const change = config.connections.enable(schemaOf(config), googleFor(config), {
      given: ["display name", "scopes"],
    });

    expect(messages(change.notices)).toEqual([
      `${IDPS}/google.json already exists, so the display name and scopes you gave were not applied. Edit the file to change them.`,
    ]);
  });

  it("says nothing about a setting given that the reused connection already has", () => {
    const config = configOf({ connections: [googleFile] });

    const change = config.connections.enable(schemaOf(config), googleFor(config), {
      given: ["display name", "scopes"],
    });

    expect(change.notices).toEqual([]);
  });

  it("warns that a new connection with no claim mapping fills no user", () => {
    const config = configOf({});
    const unmapped = Connection.forProvider(
      idpProvider("google"),
      schemaOf(configOf({ schemas: [{ path: SCHEMA, body: { objectType: "customers" } }] })),
    );

    const change = config.connections.enable(schemaOf(config), unmapped);

    expect(change.notices).toContainEqual({
      severity: "warning",
      message:
        `${SCHEMA} defines none of the properties Google maps by default, so ${IDPS}/google.json has no claim_mapping ` +
        `and no sign-in can fill a user. Add the properties your provider returns to claim_mapping in ${IDPS}/google.json.`,
    });
  });

  it("summarises the claim mapping a connection of the developer's own was written with", () => {
    const config = configOf({});
    const acme = Connection.forProvider(
      new CustomOidcProvider({
        slug: slug("acme-sso"),
        displayName: displayName("Acme SSO"),
        issuer: issuer("https://sso.acme.example"),
        scopes: ["openid", "profile", "email"] as Scopes,
      }),
      schemaOf(config),
    );

    const change = config.connections.enable(schemaOf(config), acme);

    expect(change.notices).toEqual([
      {
        severity: "info",
        message: [
          `Claim mappings in ${IDPS}/acme-sso.json. Each line is an attribute of your user schema, then the claim Acme SSO must return for it:`,
          "  email ← email",
          "Verification, which a mapping alone does not give:",
          "  email is treated as verified only when Acme SSO says so in the email_verified claim.",
          "Edit the mappings in that file if your provider returns other claims.",
        ].join("\n"),
      },
    ]);
  });

  it("says nothing is treated as verified when the connection verifies nothing", () => {
    const config = configOf({});
    const acme = Connection.create({
      path: `${IDPS}/acme-sso.json`,
      body: {
        slug: "acme-sso",
        protocol: "oidc",
        display_name: "Acme SSO",
        claim_mapping: { email: "mail" },
        oidc: { issuer: "https://sso.acme.example" },
      },
    });

    const change = config.connections.enable(schemaOf(config), acme);

    expect(messages(change.notices).join("\n")).toContain("Nothing is treated as verified.");
  });

  it("leaves a hand-edited password step alone and says what to add to it", () => {
    const flow = loginFlow("customers");
    const config = configOf({
      flows: [
        customersLogin({
          steps: [
            {
              ...flow.steps[0],
              transitions: {
                submit: { target: "password" },
                user_not_found: { target: "register" },
              },
            },
            flow.steps[1],
            {
              name: "password",
              title: "Hand-written",
              fields: ["password"],
              actions: [{ name: "submit", kind: "submit", primary: true }],
              transitions: { submit: { target: "done" } },
            },
            ...flow.steps.slice(2),
          ],
        }),
      ],
    });

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message:
        `${FLOW} steps.password has been edited by hand, so it was left alone. Add google to its sso_providers, ` +
        "and route sso_authenticated to the step a sign-in ends on, sso_user_not_found to register-sso and user_already_exists to sso-conflict.",
    });
  });

  it("leaves a hand-edited conflict step alone and says to add the provider to it", () => {
    const enabled = configOf({}).connections.enable(
      schemaOf(configOf({})),
      googleFor(configOf({})),
    );
    const generated = enabled.after.flows.all[0]?.body as { steps: Array<Record<string, unknown>> };
    const steps = generated.steps.map((step) => {
      if (step.name !== "sso-conflict") {
        return step;
      }
      return { ...step, title: "Hand-written" };
    });
    const config = configOf({ flows: [customersLogin({ ...generated, steps })] });

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message: `${FLOW} steps.sso-conflict has been edited by hand, so it was left alone. Add google to its sso_providers.`,
    });
  });

  it("leaves any other hand-edited step alone and says to update it", () => {
    const enabled = configOf({}).connections.enable(
      schemaOf(configOf({})),
      googleFor(configOf({})),
    );
    const generated = enabled.after.flows.all[0]?.body as { steps: Array<Record<string, unknown>> };
    const steps = generated.steps.map((step) => {
      if (step.name !== "register-sso") {
        return step;
      }
      return { ...step, title: "Hand-written" };
    });
    const config = configOf({ flows: [customersLogin({ ...generated, steps })] });

    const change = config.connections.enable(schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message: `${FLOW} steps.register-sso has been edited by hand, so it was left alone. Update it yourself.`,
    });
  });
});

describe("Connections.findUnused", () => {
  describe("when nothing offers the provider any more", () => {
    it("is the connection, with the variables only it reads", () => {
      const config = configOf({});
      const enabled = config.connections.enable(schemaOf(config), googleFor(config)).after;

      const change = enabled.connections.disable(schemaOf(enabled), "google");

      expect(change.after.connections.findUnused("google")).toEqual({
        connection: change.after.connections.find("google"),
        variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      });
    });

    it("leaves out the variables another connection reads too", () => {
      const config = configOf({
        connections: [
          googleFile,
          {
            path: `${IDPS}/google-staff.json`,
            body: { ...googleFile.body, slug: "google-staff", template: undefined },
          },
        ],
      });

      const unused = config.connections.findUnused("google");

      expect(unused?.variables).toEqual([]);
    });
  });

  describe("while a schema or flow still offers the provider", () => {
    it("is nothing", () => {
      const config = configOf({});
      const enabled = config.connections.enable(schemaOf(config), googleFor(config)).after;

      const unused = enabled.connections.findUnused("google");

      expect(unused).toBeUndefined();
    });
  });

  describe("when no file has the provider", () => {
    it("is nothing", () => {
      const config = configOf({});

      const unused = config.connections.findUnused("google");

      expect(unused).toBeUndefined();
    });
  });
});

describe("Connections.disable", () => {
  /** The project with Google enabled on the customers schema. */
  function withGoogle(): ZitadelConfig {
    const config = configOf({});
    return config.connections.enable(schemaOf(config), googleFor(config)).after;
  }

  it("takes the provider out of the schema and every flow that offers it", () => {
    const config = withGoogle();

    const change = config.connections.disable(schemaOf(config), "google");

    expect({
      providers: change.after.schemas.get(SCHEMA)?.providers,
      offered: change.after.connections.findOfferingPaths("google"),
    }).toEqual({ providers: [], offered: [] });
  });

  it("keeps the connection file", () => {
    const config = withGoogle();

    const change = config.connections.disable(schemaOf(config), "google");

    expect(change.after.connections.find("google")?.path).toBe(`${IDPS}/google.json`);
  });

  it("says the steps the provider's sign-in used stay for the next provider", () => {
    const config = withGoogle();

    const change = config.connections.disable(schemaOf(config), "google");

    expect(change.notices).toContainEqual({
      severity: "info",
      message: `The steps register-sso and sso-conflict stay in ${FLOW} for the next provider you enable.`,
    });
  });

  it("says the connection and its variables stay, so enabling it again asks for nothing", () => {
    const config = withGoogle();

    const change = config.connections.disable(schemaOf(config), "google");

    expect(messages(change.notices)).toContainEqual(
      `${IDPS}/google.json and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay, so enabling google again does not ask for its credentials. ` +
        "Deploys publish the connection until you delete the file; the server keeps it either way, " +
        "as deleting a connection is not supported yet.",
    );
  });

  it("refuses to remove the last way to sign in unless forced", () => {
    const config = configOf({
      schemas: [
        {
          path: SCHEMA,
          body: {
            objectType: "customers",
            properties: { email: { type: "string" } },
            "x-auth-methods": { sso: { enabled: true, providers: ["google"] } },
          },
        },
      ],
      flows: [],
      connections: [googleFile],
    });

    expect(
      thrownBy(() => {
        config.connections.disable(schemaOf(config), "google");
      }),
    ).toBeInstanceOf(NoSignInLeftError);
  });

  it("removes the last way to sign in when forced", () => {
    const config = configOf({
      schemas: [
        {
          path: SCHEMA,
          body: {
            objectType: "customers",
            properties: { email: { type: "string" } },
            "x-auth-methods": { sso: { enabled: true, providers: ["google"] } },
          },
        },
      ],
      flows: [],
      connections: [googleFile],
    });

    const change = config.connections.disable(schemaOf(config), "google", { force: true });

    expect(change.after.schemas.get(SCHEMA)?.providers).toEqual([]);
  });

  it("refuses a provider nothing knows, listing what the schema offers and the connections", () => {
    const config = configOf({
      schemas: [customers({ sso: { enabled: true, providers: ["github"] } })],
      connections: [{ path: `${IDPS}/github.json`, body: { slug: "github", protocol: "oidc" } }],
    });

    expect(() => {
      config.connections.disable(schemaOf(config), "gogle");
    }).toThrow(
      expect.objectContaining({
        name: "NotFoundError",
        message: "customers has no provider named gogle",
        hint: "customers offers: github. Connections under .zitadel/idps/: github.",
        details: { requested: "gogle", offered: ["github"], connections: ["github"] },
      }),
    );
  });

  it("says when the schema offers none and no connection exists", () => {
    const config = configOf({});

    expect(() => {
      config.connections.disable(schemaOf(config), "gogle");
    }).toThrow(
      expect.objectContaining({
        hint: "customers offers: none. Connections under .zitadel/idps/: none.",
      }),
    );
  });

  it("changes nothing for a provider a connection names that nothing offers", () => {
    const config = configOf({
      connections: [{ path: `${IDPS}/acme.json`, body: { slug: "acme-sso", protocol: "oidc" } }],
    });

    expect(config.connections.disable(schemaOf(config), "acme-sso").changed).toBe(false);
  });

  it("knows a connection with no slug by its file name", () => {
    const config = configOf({
      connections: [{ path: `${IDPS}/okta.json`, body: { protocol: "oidc" } }],
    });

    expect(config.connections.disable(schemaOf(config), "okta").changed).toBe(false);
  });

  it("changes nothing for a catalog provider the project has no connection for", () => {
    const config = configOf({});

    expect(config.connections.disable(schemaOf(config), "google").changed).toBe(false);
  });

  it("refuses a flow whose provider lists are not the shape the edit writes", () => {
    const flow = loginFlow("customers");
    const config = configOf({
      flows: [
        customersLogin({
          steps: [{ ...flow.steps[0], sso_providers: "google" }, ...flow.steps.slice(1)],
        }),
      ],
    });

    expect(
      thrownBy(() => {
        config.connections.disable(schemaOf(config), "google");
      }),
    ).toBeInstanceOf(RefusedEditError);
  });
});

describe("Connections.resolveExisting for a catalog provider", () => {
  it("is nothing when the project has no connection to the provider", () => {
    expect(connectionsOf([]).resolveExisting(google)).toBeUndefined();
  });

  it("is the connection the provider already has", () => {
    const existing = connection("google.json", googleBody());

    expect(connectionsOf([existing]).resolveExisting(google)).toEqual(existing);
  });

  it("recognises the provider by its slug and issuer when the template was removed", () => {
    const existing = connection("google.json", googleBody({ template: undefined }));

    expect(connectionsOf([existing]).resolveExisting(google)).toEqual(existing);
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

    expect(connectionsOf([corp]).resolveExisting(google)).toBeUndefined();
  });

  it("ignores connections to other providers", () => {
    const okta = connection("okta.json", {
      slug: "okta",
      template: "okta",
      oidc: { issuer: "https://acme.okta.com" },
    });

    expect(connectionsOf([okta]).resolveExisting(google)).toBeUndefined();
  });

  it("does not mistake a connection for colliding with itself", () => {
    const only = connection("google.json", googleBody());

    expect(connectionsOf([only]).resolveExisting(google)).toEqual(only);
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

    expect(connectionsOf([literal]).resolveExisting(google)).toEqual(literal);
  });

  it("reuses without complaint when the client id given is the one it holds", () => {
    const existing = connection("google.json", googleBody());

    expect(
      connectionsOf([existing]).resolveExisting(google, { clientId: validated(parseClientId("111.apps.googleusercontent.com")) }),
    ).toEqual(existing);
  });

  it("refuses two connections to the provider, naming both", () => {
    const connections = [
      connection("google.json", googleBody()),
      connection("google-work.json", googleBody({ slug: "google_work" })),
    ];

    expect(() => {
      connectionsOf(connections).resolveExisting(google);
    }).toThrow(
      expect.objectContaining({
        name: "ConflictError",
        message: `More than one Google connection exists: ${IDPS}/google-work.json, ${IDPS}/google.json`,
      }),
    );
  });

  it("refuses a client id other than the one the connection holds", () => {
    const existing = connection("google.json", googleBody());

    expect(() => {
      connectionsOf([existing]).resolveExisting(google, { clientId: validated(parseClientId("999.apps.googleusercontent.com")) });
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
      connectionsOf([connection("google.json", body)]).resolveExisting(google);
    }).toThrow(
      expect.objectContaining({
        name: "ConfigError",
        message: `${IDPS}/google.json is a Google connection with no usable slug`,
      }),
    );
  });

  it("says a google.json that has the slug but another issuer is not a Google connection", () => {
    expect(() => {
      connectionsOf([localGoogle]).resolveExisting(google);
    }).toThrow(/is a connection called google, but not to Google/);
  });

  it("points the refusal at the file and the schemas and flows, not at a flag", () => {
    const error = thrownBy(() => {
      connectionsOf([localGoogle]).resolveExisting(google);
    });

    expect(error).toMatchObject({
      hint: expect.stringContaining("in the schemas and flows that name it"),
    });
  });

  it("names no flag in the refusal's hint", () => {
    const error = thrownBy(() => {
      connectionsOf([localGoogle]).resolveExisting(google);
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
      connectionsOf([squatter]).resolveExisting(google);
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
        connectionsOf([okta]).resolveExisting(google);
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
      connectionsOf([okta]).resolveExisting(google);
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
      connectionsOf([connection("google.json", googleBody()), okta]).resolveExisting(google);
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
      connectionsOf([both]).resolveExisting(google);
    }).toThrow("This connection points both credentials at GOOGLE_CLIENT_SECRET");
  });
});

describe("Connections.resolveExisting for a connection of the developer's own", () => {
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
    expect(connectionsOf([]).resolveExisting(custom())).toBeUndefined();
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

    expect(connectionsOf([staff]).resolveExisting(custom())).toBeUndefined();
  });

  it("is not confused by a catalog connection to the same issuer", () => {
    const candidate = custom({ issuer: issuer("https://accounts.google.com") });

    const existing = connection("google.json", googleBody());

    expect(connectionsOf([existing]).resolveExisting(candidate)).toBeUndefined();
  });

  it("is the connection that already has the slug and issuer", () => {
    const existing = connection("acme-sso.json", acmeBody());

    expect(connectionsOf([existing]).resolveExisting(custom())).toEqual(existing);
  });

  it("finds the connection by its slug when the file was renamed", () => {
    const existing = connection("sso.json", acmeBody());

    expect(connectionsOf([existing]).resolveExisting(custom())).toEqual(existing);
  });

  it("finds the connection whose file spells the slug with spaces", () => {
    const existing = connection("acme-sso.json", acmeBody({ slug: " acme-sso " }));

    expect(connectionsOf([existing]).resolveExisting(custom())).toEqual(existing);
  });

  it("takes a trailing slash for a different issuer, as the server does", () => {
    const existing = connection("acme-sso.json", acmeBody());

    expect(
      thrownBy(() => {
        connectionsOf([existing]).resolveExisting(custom({ issuer: issuer("https://sso.acme.example/") }));
      }),
    ).toBeInstanceOf(ConflictError);
  });

  it("refuses a slug that belongs to a connection to another issuer", () => {
    const existing = connection("acme-sso.json", acmeBody());

    expect(() => {
      connectionsOf([existing]).resolveExisting(custom({ issuer: issuer("https://sso.other.example") }));
    }).toThrow(/already named acme-sso and connects to https:\/\/sso\.acme\.example/);
  });

  it("points a refused issuer at another slug, because an applied connection keeps its issuer", () => {
    const existing = connection("acme-sso.json", acmeBody());
    const error = thrownBy(() => {
      connectionsOf([existing]).resolveExisting(custom({ issuer: issuer("https://sso.other.example") }));
    });

    expect(error).toMatchObject({ hint: expect.stringContaining("Choose another slug") });
  });

  it("refuses a slug that belongs to a connection without an oidc block", () => {
    const existing = connection("acme-sso.json", { slug: "acme-sso", protocol: "oidc" });

    expect(() => {
      connectionsOf([existing]).resolveExisting(custom());
    }).toThrow(/not an OIDC connection/);
  });

  it("refuses an unrelated file already where the connection would go", () => {
    const occupied = connection("acme-sso.json", acmeBody({ slug: "something-else" }));

    expect(() => {
      connectionsOf([occupied]).resolveExisting(custom());
    }).toThrow(`${IDPS}/acme-sso.json already exists and is not the acme-sso connection`);
  });

  it("asks for another slug, naming no flag, when the file name is taken", () => {
    const occupied = connection("acme-sso.json", acmeBody({ slug: "something-else" }));
    const error = thrownBy(() => {
      connectionsOf([occupied]).resolveExisting(custom());
    });

    expect(error).toMatchObject({
      hint: "Rename or remove that file, or choose another slug, then run the command again.",
    });
  });

  it("refuses two files that claim the slug", () => {
    const connections = [connection("a.json", acmeBody()), connection("b.json", acmeBody())];

    expect(() => {
      connectionsOf(connections).resolveExisting(custom());
    }).toThrow(/More than one connection is named acme-sso/);
  });

  it("refuses a client id other than the literal one the connection holds", () => {
    const existing = connection(
      "acme-sso.json",
      acmeBody({ oidc: { ...acmeOidc, client_id: "literal-id" } }),
    );

    expect(() => {
      connectionsOf([existing]).resolveExisting(custom(), { clientId: validated(parseClientId("another-id")) });
    }).toThrow(/already uses client id literal-id/);
  });

  it("refuses a new slug whose derived variables another connection already uses", () => {
    // `acme_sso` and `acme-sso` both derive ACME_SSO_CLIENT_ID.
    const existing = connection("acme_sso.json", acmeBody({ slug: "acme_sso" }));

    expect(() => {
      connectionsOf([existing]).resolveExisting(custom());
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
      connectionsOf([okta]).resolveExisting(custom());
    }).toThrow(`${IDPS}/okta.json and acme-sso both use ACME_SSO_CLIENT_SECRET`);
  });

  it("reads the credentials a reused connection actually references", () => {
    const existing = connection(
      "acme-sso.json",
      acmeBody({ oidc: { ...acmeOidc, client_secret: "${{ ACME_SECRET }}" } }),
    );

    expect(connectionsOf([existing]).resolveExisting(custom())?.credentialNames.clientSecret).toEqual(
      "ACME_SECRET",
    );
  });
});

describe("Connections.resolveBySlug", () => {
  const acme = connection("acme-sso.json", {
    slug: "acme-sso",
    display_name: "Acme SSO",
    oidc: { issuer: "https://sso.acme.example", scopes: ["openid", "email"] },
  });

  it("is the single connection that declares the slug", () => {
    expect(connectionsOf([acme]).resolveBySlug("acme-sso")).toEqual(acme);
  });

  it("is nothing for a slug that is free", () => {
    expect(connectionsOf([acme]).resolveBySlug("other-sso")).toBeUndefined();
  });

  it("refuses two connections that declare the same slug", () => {
    const twin = connection("acme-sso-copy.json", acme.body);

    expect(() => {
      connectionsOf([acme, twin]).resolveBySlug("acme-sso");
    }).toThrow(
      expect.objectContaining({
        name: "ConflictError",
        message: `More than one connection is named acme-sso: ${IDPS}/acme-sso-copy.json, ${IDPS}/acme-sso.json`,
      }),
    );
  });

  it("accepts the issuer the connection was written with", () => {
    expect(connectionsOf([acme]).resolveBySlug("acme-sso", "https://sso.acme.example")).toEqual(acme);
  });

  it("refuses another issuer, even one that differs by a trailing slash", () => {
    expect(() => {
      connectionsOf([acme]).resolveBySlug("acme-sso", "https://sso.acme.example/");
    }).toThrow(
      `${IDPS}/acme-sso.json is already named acme-sso and connects to https://sso.acme.example, not https://sso.acme.example/`,
    );
  });

  it("refuses a connection that has no issuer at all", () => {
    const bare = connection("acme-sso.json", { slug: "acme-sso" });

    expect(() => {
      connectionsOf([bare]).resolveBySlug("acme-sso", "https://a.example");
    }).toThrow(
      `${IDPS}/acme-sso.json is already named acme-sso and is not an OIDC connection to https://a.example`,
    );
  });

  it("states both issuers for a --json reader", () => {
    const error = thrownBy(() => {
      connectionsOf([acme]).resolveBySlug("acme-sso", "https://sso.other.example");
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

describe("Connections.findSameIssuer", () => {
  describe("with a connection of the developer's own to the candidate's issuer", () => {
    it("names it", () => {
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

      const paths = connectionsOf([work]).findSameIssuer(google);

      expect(paths).toEqual([`${IDPS}/google-work.json`]);
    });
  });

  describe("with a connection that names no issuer", () => {
    it("names nothing", () => {
      const connections = connectionsOf([connection("okta.json", { slug: "okta" })]);

      const paths = connections.findSameIssuer(google);

      expect(paths).toEqual([]);
    });
  });
});
