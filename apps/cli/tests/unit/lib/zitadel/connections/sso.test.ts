import { describe, expect, it } from "vitest";

import { CustomOidcProvider, idpProvider, type Scopes } from "@zitadel/config/idp";

import {
  Connection,
  NoSignInLeftError,
  NotFoundError,
  RefusedEditError,
  type UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import { disableSso, enableSso, ssoFlows } from "@/lib/zitadel/connections/sso";
import { displayName, issuer, slug } from "@tests/helpers/idp-values";
import { loginFlow } from "@tests/helpers/local-project";
import { thrownBy } from "@tests/helpers/thrown-value";

const SCHEMA = ".zitadel/schemas/customers.json";
const FLOW = ".zitadel/flows/customers-login.json";
const IDPS = ".zitadel/idps";

type Entry = Readonly<{ path: string; body: Record<string, unknown> }>;

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
    schemas: input.schemas ?? [customers()],
    flows: input.flows ?? [customersLogin()],
    connections: input.connections ?? [],
    policies: [],
    branding: [],
  });
}

function schemaOf(config: ZitadelConfig): UserSchema {
  const schema = config.schema(SCHEMA);
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

describe("ssoFlows", () => {
  it("is the flows that run against the schema", () => {
    const config = configOf({});

    expect(
      ssoFlows(config, schemaOf(config)).map((flow) => {
        return flow.path;
      }),
    ).toEqual([FLOW]);
  });

  it("refuses a schema no login flow runs against, naming it", () => {
    const config = configOf({ flows: [] });

    expect(() => {
      ssoFlows(config, schemaOf(config));
    }).toThrow(
      expect.objectContaining({
        name: "NotFoundError",
        message: "No login flow runs against customers",
        details: { schema: SCHEMA },
      }),
    );
  });

  it("refuses a schema whose sso method is not the shape the edit writes", () => {
    const config = configOf({ schemas: [customers({ sso: true })] });

    expect(() => {
      ssoFlows(config, schemaOf(config));
    }).toThrow(
      expect.objectContaining({
        name: "RefusedEditError",
        message: `${SCHEMA}: x-auth-methods.sso is not an object`,
      }),
    );
  });

  it("refuses a flow whose steps are not the shape the edit writes", () => {
    const config = configOf({ flows: [customersLogin({ steps: {} })] });

    expect(() => {
      ssoFlows(config, schemaOf(config));
    }).toThrow(
      expect.objectContaining({
        name: "RefusedEditError",
        message: `${FLOW}: steps is not a list`,
      }),
    );
  });
});

describe("enableSso", () => {
  it("creates the connection when the project has none for the provider", () => {
    const config = configOf({});

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(change.createdPaths).toEqual([`${IDPS}/google.json`]);
  });

  it("reuses the connection the project already has", () => {
    const config = configOf({ connections: [googleFile] });

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(change.changedPaths).toEqual([SCHEMA, FLOW]);
  });

  it("lists the provider in the schema", () => {
    const config = configOf({});

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(change.after.schema(SCHEMA)?.providers).toEqual(["google"]);
  });

  it("offers the provider on every flow that runs against the schema", () => {
    const config = configOf({});

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(
      change.after.flows.map((flow) => {
        return flow.offers("google");
      }),
    ).toEqual([true]);
  });

  it("refuses a schema no login flow runs against", () => {
    const config = configOf({ flows: [] });

    expect(
      thrownBy(() => {
        enableSso(config, schemaOf(config), googleFor(config));
      }),
    ).toBeInstanceOf(NotFoundError);
  });

  it("says nothing more for a new catalog connection that maps the schema", () => {
    const config = configOf({});

    const change = enableSso(config, schemaOf(config), googleFor(config));

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

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message: `${IDPS}/google-work.json already connects to Google's issuer under another slug, so this adds a second Google connection and button.`,
    });
  });

  it("says a setting given for a reused connection was not applied", () => {
    const config = configOf({
      connections: [{ ...googleFile, body: { ...googleFile.body, display_name: "Old name" } }],
    });

    const change = enableSso(config, schemaOf(config), googleFor(config), {
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

    const change = enableSso(config, schemaOf(config), googleFor(config), {
      given: ["display name", "scopes"],
    });

    expect(messages(change.notices)).toEqual([
      `${IDPS}/google.json already exists, so the display name and scopes you gave were not applied. Edit the file to change them.`,
    ]);
  });

  it("says nothing about a setting given that the reused connection already has", () => {
    const config = configOf({ connections: [googleFile] });

    const change = enableSso(config, schemaOf(config), googleFor(config), {
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

    const change = enableSso(config, schemaOf(config), unmapped);

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

    const change = enableSso(config, schemaOf(config), acme);

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

    const change = enableSso(config, schemaOf(config), acme);

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

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message:
        `${FLOW} steps.password has been edited by hand, so it was left alone. Add google to its sso_providers, ` +
        "and route sso_authenticated to the step a sign-in ends on, sso_user_not_found to register-sso and user_already_exists to sso-conflict.",
    });
  });

  it("leaves a hand-edited conflict step alone and says to add the provider to it", () => {
    const enabled = enableSso(configOf({}), schemaOf(configOf({})), googleFor(configOf({})));
    const generated = enabled.after.flows[0]?.body as { steps: Array<Record<string, unknown>> };
    const steps = generated.steps.map((step) => {
      if (step.name !== "sso-conflict") {
        return step;
      }
      return { ...step, title: "Hand-written" };
    });
    const config = configOf({ flows: [customersLogin({ ...generated, steps })] });

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message: `${FLOW} steps.sso-conflict has been edited by hand, so it was left alone. Add google to its sso_providers.`,
    });
  });

  it("leaves any other hand-edited step alone and says to update it", () => {
    const enabled = enableSso(configOf({}), schemaOf(configOf({})), googleFor(configOf({})));
    const generated = enabled.after.flows[0]?.body as { steps: Array<Record<string, unknown>> };
    const steps = generated.steps.map((step) => {
      if (step.name !== "register-sso") {
        return step;
      }
      return { ...step, title: "Hand-written" };
    });
    const config = configOf({ flows: [customersLogin({ ...generated, steps })] });

    const change = enableSso(config, schemaOf(config), googleFor(config));

    expect(change.notices).toContainEqual({
      severity: "warning",
      message: `${FLOW} steps.register-sso has been edited by hand, so it was left alone. Update it yourself.`,
    });
  });
});

describe("disableSso", () => {
  /** The project with Google enabled on the customers schema. */
  function withGoogle(): ZitadelConfig {
    const config = configOf({});
    return enableSso(config, schemaOf(config), googleFor(config)).after;
  }

  it("takes the provider out of the schema and every flow that offers it", () => {
    const config = withGoogle();

    const change = disableSso(config, schemaOf(config), "google");

    expect({
      providers: change.after.schema(SCHEMA)?.providers,
      offered: change.after.offeredBy("google"),
    }).toEqual({ providers: [], offered: [] });
  });

  it("keeps the connection file", () => {
    const config = withGoogle();

    const change = disableSso(config, schemaOf(config), "google");

    expect(change.after.connection("google")?.path).toBe(`${IDPS}/google.json`);
  });

  it("says the steps the provider's sign-in used stay for the next provider", () => {
    const config = withGoogle();

    const change = disableSso(config, schemaOf(config), "google");

    expect(change.notices).toContainEqual({
      severity: "info",
      message: `The steps register-sso and sso-conflict stay in ${FLOW} for the next provider you enable.`,
    });
  });

  it("says the connection and its variables stay, so enabling it again asks for nothing", () => {
    const config = withGoogle();

    const change = disableSso(config, schemaOf(config), "google");

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
        disableSso(config, schemaOf(config), "google");
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

    const change = disableSso(config, schemaOf(config), "google", { force: true });

    expect(change.after.schema(SCHEMA)?.providers).toEqual([]);
  });

  it("refuses a provider nothing knows, listing what the schema offers and the connections", () => {
    const config = configOf({
      schemas: [customers({ sso: { enabled: true, providers: ["github"] } })],
      connections: [
        { path: `${IDPS}/github.json`, body: { slug: "github", protocol: "oidc" } },
      ],
    });

    expect(() => {
      disableSso(config, schemaOf(config), "gogle");
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
      disableSso(config, schemaOf(config), "gogle");
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

    expect(disableSso(config, schemaOf(config), "acme-sso").changed).toBe(false);
  });

  it("knows a connection with no slug by its file name", () => {
    const config = configOf({
      connections: [{ path: `${IDPS}/okta.json`, body: { protocol: "oidc" } }],
    });

    expect(disableSso(config, schemaOf(config), "okta").changed).toBe(false);
  });

  it("changes nothing for a catalog provider the project has no connection for", () => {
    const config = configOf({});

    expect(disableSso(config, schemaOf(config), "google").changed).toBe(false);
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
        disableSso(config, schemaOf(config), "google");
      }),
    ).toBeInstanceOf(RefusedEditError);
  });
});
