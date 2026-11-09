import { describe, expect, it } from "vitest";

import { idpProvider } from "@zitadel/config/idp";

import {
  ConfigError,
  ConflictError,
  Connection,
  isJsonObject,
  type JsonObject,
  NoSignInLeftError,
  NotFoundError,
  UserSchema,
} from "@/lib/zitadel";
import { listAt } from "@/lib/zitadel/utils/json";
import {
  aConfig,
  aFile,
  aGoogleConnection,
  aLoginFlow,
  anOidcConnection,
  authMethods,
  aUserSchema,
  type ConfigDocuments,
  type ConnectionOverrides,
} from "@tests/helpers/config";
import {
  aCustomersSchema,
  anAcmeSsoConnection,
  anAcmeSsoProvider,
  CUSTOMERS_PROJECT,
  CUSTOMERS_SCHEMA,
  onlyFlowOf,
  withStepChanged,
} from "@tests/helpers/connections";
import { clientId, issuer } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The directory connections sit in.
 */
const IDPS = ".zitadel/idps";

/**
 * The file of the `customers` schema.
 */
const SCHEMA_FILE = ".zitadel/schemas/customers.json";

/**
 * The file of the login flow run against the `customers` schema.
 */
const FLOW_FILE = ".zitadel/flows/customers-login.json";

/**
 * The file a Google connection is written to.
 */
const GOOGLE_FILE = `${IDPS}/google.json`;

/**
 * The file the `acme-sso` connection is written to.
 */
const ACME_SSO_FILE = `${IDPS}/acme-sso.json`;

/**
 * The issuer the `acme-sso` connection was written with.
 */
const ACME_SSO_ISSUER = "https://sso.acme.example";

/**
 * The Google connection the CLI would write for the `customers` schema.
 */
const GOOGLE = Connection.forProvider(idpProvider("google"), CUSTOMERS_SCHEMA);

/**
 * The `acme-sso` connection the CLI would write for the `customers` schema.
 */
const ACME_SSO = Connection.forProvider(anAcmeSsoProvider(), CUSTOMERS_SCHEMA);

/**
 * What a Google connection already in the project holds beyond the catalog
 * default: a claim mapping, a client id variable and the catalog's scopes.
 */
const ON_FILE = {
  claim_mapping: { email: "email" },
  oidc: { client_id: "${{ GOOGLE_CLIENT_ID }}", scopes: ["openid", "profile", "email"] },
} as const satisfies ConnectionOverrides;

/**
 * The Google connection already in the project.
 */
const GOOGLE_ON_FILE = aGoogleConnection(ON_FILE);

/**
 * The `customers` project with Google enabled.
 */
const WITH_GOOGLE = aConfig(CUSTOMERS_PROJECT).connections.enable(CUSTOMERS_SCHEMA, GOOGLE).after;

/**
 * A step changed by hand.
 */
const HAND_EDIT = { title: "Hand-written" };

/**
 * A connection of the developer's own, `okta`, whose client secret is the
 * `${{ GOOGLE_CLIENT_SECRET }}` variable the catalog Google connection derives.
 */
const OKTA_ON_GOOGLE_SECRET = anOidcConnection({
  slug: "okta",
  oidc: {
    issuer: "https://acme.okta.com",
    client_id: "${{ OKTA_CLIENT_ID }}",
    client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
  },
});

describe("Connections.enable", () => {
  describe("when the project has no connection for the provider", () => {
    it("creates the connection", () => {
      const config = aConfig(CUSTOMERS_PROJECT);

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect(change.createdPaths).toEqual([GOOGLE_FILE]);
    });

    it("is about the connection it creates", () => {
      const config = aConfig(CUSTOMERS_PROJECT);

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect({ path: change.document.path, created: change.created }).toEqual({
        path: GOOGLE_FILE,
        created: true,
      });
    });

    it("lists the provider in the schema", () => {
      const config = aConfig(CUSTOMERS_PROJECT);

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect(change.after.schemas.get(SCHEMA_FILE)?.providers).toEqual(["google"]);
    });

    it("offers the provider on every flow that runs against the schema", () => {
      const config = aConfig(CUSTOMERS_PROJECT);

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect(
        change.after.flows.all.map((flow) => {
          return flow.offers("google");
        }),
      ).toEqual([true]);
    });

    it("says nothing more for a catalog connection that maps the schema", () => {
      const config = aConfig(CUSTOMERS_PROJECT);

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect(change.notices).toEqual([]);
    });
  });

  describe("when the project already has the connection", () => {
    it("reuses it, changing only the schema and the flow", () => {
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        connections: { "google.json": GOOGLE_ON_FILE },
      });

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect(change.changedPaths).toEqual([SCHEMA_FILE, FLOW_FILE]);
    });

    it("is about the connection it reuses, which it does not create", () => {
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        connections: { "google.json": GOOGLE_ON_FILE },
      });

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect({ document: change.document, created: change.created }).toEqual({
        document: config.connections.find("google"),
        created: false,
      });
    });

    it("says nothing about a setting given that the connection already has", () => {
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        connections: { "google.json": GOOGLE_ON_FILE },
      });

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE, {
        given: ["display name", "scopes"],
      });

      expect(change.notices).toEqual([]);
    });

    it.each([
      [
        "says a setting given that was not applied",
        aGoogleConnection({ ...ON_FILE, display_name: "Old name" }),
        ["display name"],
        `${GOOGLE_FILE} already exists, so the display name you gave was not applied. Edit the file to change it.`,
      ],
      [
        "says every setting given that was not applied",
        aGoogleConnection({
          ...ON_FILE,
          display_name: "Old name",
          oidc: { ...ON_FILE.oidc, scopes: ["openid"] },
        }),
        ["display name", "scopes"],
        `${GOOGLE_FILE} already exists, so the display name and scopes you gave were not applied. Edit the file to change them.`,
      ],
    ] as const)("%s", (_claim, google, given, message) => {
      const config = aConfig({ ...CUSTOMERS_PROJECT, connections: { "google.json": google } });

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE, { given });

      expect(change.notices).toEqual([{ severity: "warning", message }]);
    });
  });

  describe("when another connection reaches the provider's issuer under another slug", () => {
    it("says this adds a second connection and button", () => {
      const work = anOidcConnection({
        slug: "google-work",
        claim_mapping: { email: "email" },
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ WORK_CLIENT_ID }}",
          client_secret: "${{ WORK_CLIENT_SECRET }}",
        },
      });
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        connections: { "google-work.json": work },
      });

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect(change.notices).toContainEqual({
        severity: "warning",
        message: `${IDPS}/google-work.json already connects to Google's issuer under another slug, so this adds a second Google connection and button.`,
      });
    });
  });

  describe("when no connection names an issuer", () => {
    it("says nothing about a second connection to the issuer", () => {
      const candidate = Connection.of(
        aFile("connections", "okta.json", {
          slug: "okta",
          protocol: "oidc",
          display_name: "Okta",
          template: "okta",
        }),
      );
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        connections: { "other.json": { slug: "other", protocol: "oidc", display_name: "Other" } },
      });

      const change = config.connections.enable(CUSTOMERS_SCHEMA, candidate);

      expect(
        change.notices.filter((notice) => {
          return notice.message.includes("already connects");
        }),
      ).toEqual([]);
    });
  });

  describe("when no login flow runs against the schema", () => {
    it("refuses the schema", () => {
      const config = aConfig({ schemas: CUSTOMERS_PROJECT.schemas });

      const error = thrownBy(() => {
        return config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);
      });

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toMatchObject({ message: "No login flow runs against customers" });
    });
  });

  describe("with a catalog connection the schema gives nothing to map", () => {
    it("warns that the connection fills no user", () => {
      const config = aConfig(CUSTOMERS_PROJECT);
      const unmapped = Connection.forProvider(
        idpProvider("google"),
        UserSchema.of(
          aFile(
            "schemas",
            "customers.json",
            aUserSchema({ objectType: "customers", properties: {} }),
          ),
        ),
      );

      const change = config.connections.enable(CUSTOMERS_SCHEMA, unmapped);

      expect(change.notices).toContainEqual({
        severity: "warning",
        message:
          `${SCHEMA_FILE} defines none of the properties Google maps by default, so ${GOOGLE_FILE} has no claim_mapping ` +
          `and no sign-in can fill a user. Add the properties your provider returns to claim_mapping in ${GOOGLE_FILE}.`,
      });
    });
  });

  describe("with a connection of the developer's own", () => {
    it("summarises the claim mapping it was written with", () => {
      const config = aConfig(CUSTOMERS_PROJECT);

      const change = config.connections.enable(CUSTOMERS_SCHEMA, ACME_SSO);

      expect(change.notices).toEqual([
        {
          severity: "info",
          message: [
            `Claim mappings in ${ACME_SSO_FILE}. Each line is an attribute of your user schema, then the claim Acme SSO must return for it:`,
            "  email ← email",
            "Verification, which a mapping alone does not give:",
            "  email is treated as verified only when Acme SSO says so in the email_verified claim.",
            "Edit the mappings in that file if your provider returns other claims.",
          ].join("\n"),
        },
      ]);
    });

    it("says nothing is treated as verified when the connection verifies nothing", () => {
      const config = aConfig(CUSTOMERS_PROJECT);
      const acme = Connection.create(
        aFile(
          "connections",
          "acme-sso.json",
          anAcmeSsoConnection({ claim_mapping: { email: "mail" } }),
        ),
      );

      const change = config.connections.enable(CUSTOMERS_SCHEMA, acme);

      expect(change.notices).toContainEqual({
        severity: "info",
        message: [
          `Claim mappings in ${ACME_SSO_FILE}. Each line is an attribute of your user schema, then the claim Acme SSO must return for it:`,
          "  email ← mail",
          "Nothing is treated as verified.",
          "Edit the mappings in that file if your provider returns other claims.",
        ].join("\n"),
      });
    });
  });

  describe("with a step edited by hand", () => {
    it.each([
      [
        "password",
        withStepChanged(aLoginFlow({ userSchema: "customers" }), "password", HAND_EDIT),
        "Add google to its sso_providers, and route sso_authenticated to the step a sign-in ends on, sso_user_not_found to register-sso and user_already_exists to sso-conflict.",
      ],
      [
        "sso-conflict",
        withStepChanged(onlyFlowOf(WITH_GOOGLE), "sso-conflict", HAND_EDIT),
        "Add google to its sso_providers.",
      ],
      [
        "register-sso",
        withStepChanged(onlyFlowOf(WITH_GOOGLE), "register-sso", HAND_EDIT),
        "Update it yourself.",
      ],
    ])("leaves the %s step alone and says what to do with it", (step, flow, todo) => {
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        flows: { "customers-login.json": flow },
      });

      const change = config.connections.enable(CUSTOMERS_SCHEMA, GOOGLE);

      expect(change.notices).toContainEqual({
        severity: "warning",
        message: `${FLOW_FILE} steps.${step} has been edited by hand, so it was left alone. ${todo}`,
      });
    });
  });
});

describe("Connections.findUnused", () => {
  describe("when nothing offers the provider any more", () => {
    it("is the connection, with the variables only it reads", () => {
      const disabled = WITH_GOOGLE.connections.disable(
        WITH_GOOGLE.schemas.resolve(),
        "google",
      ).after;

      const unused = disabled.connections.findUnused("google");

      expect(unused).toEqual({
        connection: disabled.connections.find("google"),
        variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      });
    });

    it("leaves out the variables another connection reads too", () => {
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        connections: {
          "google.json": GOOGLE_ON_FILE,
          "google-staff.json": aGoogleConnection({
            ...ON_FILE,
            slug: "google-staff",
            template: undefined,
          }),
        },
      });

      const unused = config.connections.findUnused("google");

      expect(unused?.variables).toEqual([]);
    });

    it("names the variables its slug derives when the file has no oidc block", () => {
      const config = aConfig({
        ...CUSTOMERS_PROJECT,
        connections: {
          "google.json": { slug: "google", protocol: "oidc", display_name: "Google" },
        },
      });

      const unused = config.connections.findUnused("google");

      expect(unused?.variables).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    });
  });

  describe("when a schema or flow still offers the provider", () => {
    it("is nothing", () => {
      const unused = WITH_GOOGLE.connections.findUnused("google");

      expect(unused).toBeUndefined();
    });
  });

  describe("when no file has the provider", () => {
    it("is nothing", () => {
      const config = aConfig(CUSTOMERS_PROJECT);

      const unused = config.connections.findUnused("google");

      expect(unused).toBeUndefined();
    });
  });
});

describe("Connections.disable", () => {
  describe("when the schema and its flow offer the provider", () => {
    it("takes the provider out of the schema and every flow that offers it", () => {
      const schema = WITH_GOOGLE.schemas.resolve();

      const change = WITH_GOOGLE.connections.disable(schema, "google");

      expect({
        providers: change.after.schemas.get(SCHEMA_FILE)?.providers,
        offered: change.after.connections.findOfferingPaths("google"),
      }).toEqual({ providers: [], offered: [] });
    });

    it("keeps the connection file", () => {
      const schema = WITH_GOOGLE.schemas.resolve();

      const change = WITH_GOOGLE.connections.disable(schema, "google");

      expect(change.after.connections.find("google")?.path).toBe(GOOGLE_FILE);
    });

    it("says the steps the provider's sign-in used stay for the next provider", () => {
      const schema = WITH_GOOGLE.schemas.resolve();

      const change = WITH_GOOGLE.connections.disable(schema, "google");

      expect(change.notices).toContainEqual({
        severity: "info",
        message: `The steps register-sso and sso-conflict stay in ${FLOW_FILE} for the next provider you enable.`,
      });
    });

    it("says the connection and its variables stay, so enabling it again asks for nothing", () => {
      const schema = WITH_GOOGLE.schemas.resolve();

      const change = WITH_GOOGLE.connections.disable(schema, "google");

      expect(change.notices).toContainEqual({
        severity: "info",
        message:
          `${GOOGLE_FILE} and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay, so enabling google again does not ask for its credentials. ` +
          "Deploys publish the connection until you delete the file; the server keeps it either way, " +
          "as deleting a connection is not supported yet.",
      });
    });
  });

  describe("when no generated step stays behind", () => {
    const STEPS_STAY = "for the next provider you enable.";

    /**
     * The messages the disabling of `google` gives.
     *
     * @param config - The project to disable it in.
     * @returns The messages, in order.
     */
    function messagesOfDisabling(config: ReturnType<typeof aConfig>): readonly string[] {
      const change = config.connections.disable(config.schemas.resolve(), "google");
      return change.notices.map((notice) => {
        return notice.message;
      });
    }

    /**
     * The `customers` project with Google enabled, but for its flow.
     *
     * @param flow - The flow to hold in place of the one enabling wrote.
     * @returns The documents.
     */
    function withGoogleAnd(flow: JsonObject): ConfigDocuments {
      return {
        schemas: { "customers.json": WITH_GOOGLE.schemas.resolve().body },
        flows: { "customers-login.json": flow },
        connections: { "google.json": WITH_GOOGLE.connections.all[0]?.body ?? {} },
      };
    }

    it("says nothing about steps while a flow still offers another provider", () => {
      const both = WITH_GOOGLE.connections.enable(WITH_GOOGLE.schemas.resolve(), ACME_SSO).after;

      const messages = messagesOfDisabling(both);

      expect(
        messages.filter((message) => {
          return message.endsWith(STEPS_STAY);
        }),
      ).toEqual([]);
    });

    it("says nothing about steps a flow does not carry", () => {
      const generated = ["register-sso", "sso-conflict"];
      const flow = onlyFlowOf(WITH_GOOGLE);
      const steps = listAt(flow, "steps")
        .filter((step) => {
          return !(isJsonObject(step) && generated.includes(String(step.name)));
        })
        .map((step) => {
          if (!isJsonObject(step) || !isJsonObject(step.transitions)) {
            return step;
          }
          const transitions = Object.entries(step.transitions).filter((entry) => {
            return !(isJsonObject(entry[1]) && generated.includes(String(entry[1].target)));
          });
          return { ...step, transitions: Object.fromEntries(transitions) };
        });
      const config = aConfig({
        ...withGoogleAnd({ ...flow, steps }),
      });

      const messages = messagesOfDisabling(config);

      expect(
        messages.filter((message) => {
          return message.endsWith(STEPS_STAY);
        }),
      ).toEqual([]);
    });

    it("says nothing about steps in a flow the change leaves as it was", () => {
      const flow = onlyFlowOf(WITH_GOOGLE);
      const steps = listAt(flow, "steps").map((step) => {
        if (!isJsonObject(step)) {
          return step;
        }
        const kept = Object.entries(step).filter((entry) => {
          return entry[0] !== "sso_providers";
        });
        return Object.fromEntries(kept);
      });
      const config = aConfig({
        ...withGoogleAnd({ ...flow, steps }),
      });

      const messages = messagesOfDisabling(config);

      expect(
        messages.filter((message) => {
          return message.endsWith(STEPS_STAY);
        }),
      ).toEqual([]);
    });
  });

  describe("when the provider is the last way to sign in", () => {
    const config = aConfig({
      schemas: {
        "customers.json": aCustomersSchema({ sso: { enabled: true, providers: ["google"] } }),
      },
      connections: { "google.json": GOOGLE_ON_FILE },
    });

    it("refuses to remove it", () => {
      const error = thrownBy(() => {
        return config.connections.disable(config.schemas.resolve(), "google");
      });

      expect(error).toBeInstanceOf(NoSignInLeftError);
    });

    it("removes it when forced", () => {
      const change = config.connections.disable(config.schemas.resolve(), "google", {
        force: true,
      });

      expect(change.after.schemas.get(SCHEMA_FILE)?.providers).toEqual([]);
    });
  });

  describe("when nothing knows the provider", () => {
    it.each([
      [
        "refuses it, listing what the schema offers and the connections",
        aConfig({
          ...CUSTOMERS_PROJECT,
          schemas: {
            "customers.json": aCustomersSchema({
              ...authMethods("password"),
              sso: { enabled: true, providers: ["github"] },
            }),
          },
          connections: { "github.json": anOidcConnection({ slug: "github" }) },
        }),
        {
          message: "customers has no provider named gogle",
          hint: "customers offers: github. Connections under .zitadel/idps/: github.",
          details: { requested: "gogle", offered: ["github"], connections: ["github"] },
        },
      ],
      [
        "says so when the schema offers none and no connection exists",
        aConfig(CUSTOMERS_PROJECT),
        { hint: "customers offers: none. Connections under .zitadel/idps/: none." },
      ],
    ])("%s", (_claim, config, fields) => {
      const error = thrownBy(() => {
        return config.connections.disable(config.schemas.resolve(), "gogle");
      });

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toMatchObject(fields);
    });
  });

  describe("when nothing offers the provider", () => {
    it.each([
      [
        "changes nothing for a provider a connection names",
        { "acme.json": anAcmeSsoConnection() },
        "acme-sso",
      ],
      ["changes nothing for a catalog provider the project has no connection for", {}, "google"],
    ])("%s", (_claim, connections, provider) => {
      const config = aConfig({ ...CUSTOMERS_PROJECT, connections });

      const change = config.connections.disable(config.schemas.resolve(), provider);

      expect(change.changed).toBe(false);
    });
  });
});

describe("Connections.resolveExisting", () => {
  describe("with a catalog candidate", () => {
    it.each([
      ["is nothing when the project has no connection to the provider", {}, undefined],
      [
        "is the connection the provider already has, which does not collide with itself",
        { "google.json": aGoogleConnection() },
        GOOGLE_FILE,
      ],
      [
        "recognises the provider by its slug and issuer when the template was removed",
        { "google.json": aGoogleConnection({ template: undefined }) },
        GOOGLE_FILE,
      ],
      [
        "does not claim a connection of the developer's own that points at the provider's issuer",
        {
          "corp.json": anOidcConnection({
            slug: "corp",
            oidc: {
              issuer: "https://accounts.google.com",
              client_id: "${{ CORP_CLIENT_ID }}",
              client_secret: "${{ CORP_CLIENT_SECRET }}",
            },
          }),
        },
        undefined,
      ],
      [
        "ignores connections to other providers",
        {
          "okta.json": anOidcConnection({
            slug: "okta",
            template: "okta",
            oidc: { issuer: "https://acme.okta.com" },
          }),
        },
        undefined,
      ],
      [
        "lets another connection use the variable a literal client id leaves unclaimed",
        {
          "google.json": aGoogleConnection({
            oidc: {
              client_id: "824.apps.googleusercontent.com",
              client_secret: "${{ SOMETHING_ELSE }}",
            },
          }),
        },
        GOOGLE_FILE,
      ],
    ])("%s", (_claim, connections, path) => {
      const config = aConfig({ connections });

      const existing = config.connections.resolveExisting(GOOGLE);

      expect(existing?.path).toBe(path);
    });

    it("reuses without complaint when the client id given is the one it holds", () => {
      const config = aConfig({ connections: { "google.json": aGoogleConnection() } });

      const existing = config.connections.resolveExisting(GOOGLE, {
        clientId: clientId("111.apps.googleusercontent.com"),
      });

      expect(existing?.path).toBe(GOOGLE_FILE);
    });

    it.each([
      [
        "refuses two connections to the provider, naming both",
        {
          "google-work.json": aGoogleConnection({ slug: "google_work" }),
          "google.json": aGoogleConnection(),
        },
        `More than one Google connection exists: ${IDPS}/google-work.json, ${GOOGLE_FILE}`,
      ],
      [
        "says a google.json that has the slug but another issuer is not a Google connection",
        {
          "google.json": aGoogleConnection({
            template: undefined,
            oidc: { issuer: "http://localhost:9100" },
          }),
        },
        `${GOOGLE_FILE} is a connection called google, but not to Google: its issuer is not https://accounts.google.com`,
      ],
      [
        "refuses to overwrite an unrelated connection already called google.json",
        {
          "google.json": aGoogleConnection({
            template: "okta",
            oidc: { issuer: "https://acme.okta.com" },
          }),
        },
        `${GOOGLE_FILE} is a connection called google, but not to Google: its issuer is not https://accounts.google.com`,
      ],
      [
        "refuses a file called google.json that holds another connection",
        {
          "google.json": aGoogleConnection({
            slug: "something-else",
            template: undefined,
            oidc: { issuer: "http://localhost:9100" },
          }),
        },
        `${GOOGLE_FILE} already exists and is not the google connection`,
      ],
      [
        "refuses a new connection whose variable a hand-edited connection already uses",
        { "okta.json": { ...OKTA_ON_GOOGLE_SECRET, template: "oidc-generic" } },
        `${IDPS}/okta.json and google both use GOOGLE_CLIENT_SECRET`,
      ],
      [
        "refuses a reused connection whose variable another connection also uses",
        { "google.json": aGoogleConnection(), "okta.json": OKTA_ON_GOOGLE_SECRET },
        `${IDPS}/okta.json and google both use GOOGLE_CLIENT_SECRET`,
      ],
      [
        "refuses a connection pointing both credentials at one variable",
        {
          "google.json": aGoogleConnection({
            oidc: { client_id: "${{ GOOGLE_CLIENT_SECRET }}" },
          }),
        },
        "This connection points both credentials at GOOGLE_CLIENT_SECRET",
      ],
    ])("%s", (_claim, connections, message) => {
      const config = aConfig({ connections });

      const error = thrownBy(() => {
        return config.connections.resolveExisting(GOOGLE);
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ message });
    });

    it.each([
      [
        "refuses a client id other than the one the connection holds",
        aGoogleConnection(),
        clientId("999.apps.googleusercontent.com"),
        `${GOOGLE_FILE} already uses client id 111.apps.googleusercontent.com, not 999.apps.googleusercontent.com`,
      ],
    ])("%s", (_claim, google, given, message) => {
      const config = aConfig({ connections: { "google.json": google } });

      const error = thrownBy(() => {
        return config.connections.resolveExisting(GOOGLE, { clientId: given });
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ message });
    });

    describe("when google.json has the slug but another issuer", () => {
      const config = aConfig({
        connections: {
          "google.json": aGoogleConnection({
            template: undefined,
            oidc: { issuer: "http://localhost:9100" },
          }),
        },
      });

      it("points the refusal at the file and the schemas and flows, not at a flag", () => {
        const error = thrownBy(() => {
          return config.connections.resolveExisting(GOOGLE);
        });

        expect(error).toBeInstanceOf(ConflictError);
        expect(error).toMatchObject({
          hint: expect.stringContaining("in the schemas and flows that name it"),
        });
      });

      it("names no flag in the refusal's hint", () => {
        const error = thrownBy(() => {
          return config.connections.resolveExisting(GOOGLE);
        });

        expect(error).toBeInstanceOf(ConflictError);
        expect(error).toMatchObject({ hint: expect.not.stringContaining("--") });
      });
    });
  });

  describe("with a candidate of the developer's own", () => {
    it.each([
      ["is nothing when no connection has the slug", {}, undefined],
      [
        "is nothing beside another connection to the same issuer under another slug",
        {
          "acme-staff.json": anAcmeSsoConnection({
            slug: "acme-staff",
            oidc: {
              client_id: "${{ ACME_STAFF_CLIENT_ID }}",
              client_secret: "${{ ACME_STAFF_CLIENT_SECRET }}",
            },
          }),
        },
        undefined,
      ],
      [
        "is the connection that already has the slug and issuer",
        { "acme-sso.json": anAcmeSsoConnection() },
        ACME_SSO_FILE,
      ],
      [
        "finds the connection by its slug when the file was renamed",
        { "sso.json": anAcmeSsoConnection() },
        `${IDPS}/sso.json`,
      ],
    ])("%s", (_claim, connections, path) => {
      const config = aConfig({ connections });

      const existing = config.connections.resolveExisting(ACME_SSO);

      expect(existing?.path).toBe(path);
    });

    it("is not confused by a catalog connection to the same issuer", () => {
      const config = aConfig({ connections: { "google.json": aGoogleConnection() } });
      const candidate = Connection.forProvider(
        anAcmeSsoProvider({ issuer: issuer("https://accounts.google.com") }),
        CUSTOMERS_SCHEMA,
      );

      const existing = config.connections.resolveExisting(candidate);

      expect(existing).toBeUndefined();
    });

    it("reads the credentials a reused connection actually references", () => {
      const config = aConfig({
        connections: {
          "acme-sso.json": anAcmeSsoConnection({ oidc: { client_secret: "${{ ACME_SECRET }}" } }),
        },
      });

      const existing = config.connections.resolveExisting(ACME_SSO);

      expect(existing?.credentials?.clientSecret).toEqual({
        kind: "variable",
        field: "client_secret",
        variable: "ACME_SECRET",
      });
    });

    it.each([
      [
        "takes a trailing slash for a different issuer, as the server does",
        { "acme-sso.json": anAcmeSsoConnection() },
        "https://sso.acme.example/",
        `${ACME_SSO_FILE} is already named acme-sso and connects to ${ACME_SSO_ISSUER}, not https://sso.acme.example/`,
      ],
      [
        "refuses a slug that belongs to a connection to another issuer",
        { "acme-sso.json": anAcmeSsoConnection() },
        "https://sso.other.example",
        `${ACME_SSO_FILE} is already named acme-sso and connects to ${ACME_SSO_ISSUER}, not https://sso.other.example`,
      ],
      [
        "refuses a slug that belongs to a connection without an oidc block",
        { "acme-sso.json": { slug: "acme-sso", protocol: "oidc", display_name: "Acme SSO" } },
        ACME_SSO_ISSUER,
        `${ACME_SSO_FILE} is already named acme-sso and is not an OIDC connection to ${ACME_SSO_ISSUER}`,
      ],
      [
        "refuses an unrelated file already where the connection would go",
        { "acme-sso.json": anAcmeSsoConnection({ slug: "something-else" }) },
        ACME_SSO_ISSUER,
        `${ACME_SSO_FILE} already exists and is not the acme-sso connection`,
      ],
      [
        "refuses two files that claim the slug",
        { "a.json": anAcmeSsoConnection(), "b.json": anAcmeSsoConnection() },
        ACME_SSO_ISSUER,
        `More than one connection is named acme-sso: ${IDPS}/a.json, ${IDPS}/b.json`,
      ],
      [
        "refuses a new slug whose derived variables another connection already uses",
        { "acme_sso.json": anAcmeSsoConnection({ slug: "acme_sso" }) },
        ACME_SSO_ISSUER,
        `${IDPS}/acme_sso.json and acme-sso both use ACME_SSO_CLIENT_ID`,
      ],
      [
        "refuses to take over a variable a hand-edited connection points at",
        {
          "okta.json": anAcmeSsoConnection({
            slug: "okta",
            oidc: { client_id: "${{ OKTA_CLIENT_ID }}" },
          }),
        },
        ACME_SSO_ISSUER,
        `${IDPS}/okta.json and acme-sso both use ACME_SSO_CLIENT_SECRET`,
      ],
    ])("%s", (_claim, connections, given, message) => {
      const config = aConfig({ connections });
      const candidate = Connection.forProvider(
        anAcmeSsoProvider({ issuer: issuer(given) }),
        CUSTOMERS_SCHEMA,
      );

      const error = thrownBy(() => {
        return config.connections.resolveExisting(candidate);
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ message });
    });

    it("refuses a client id other than the literal one the connection holds", () => {
      const config = aConfig({
        connections: {
          "acme-sso.json": anAcmeSsoConnection({ oidc: { client_id: "literal-id" } }),
        },
      });

      const error = thrownBy(() => {
        return config.connections.resolveExisting(ACME_SSO, { clientId: clientId("another-id") });
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({
        message: `${ACME_SSO_FILE} already uses client id literal-id, not another-id`,
      });
    });

    describe("when the slug belongs to a connection to another issuer", () => {
      it("points the refusal at another slug, because an applied connection keeps its issuer", () => {
        const config = aConfig({ connections: { "acme-sso.json": anAcmeSsoConnection() } });
        const candidate = Connection.forProvider(
          anAcmeSsoProvider({ issuer: issuer("https://sso.other.example") }),
          CUSTOMERS_SCHEMA,
        );

        const error = thrownBy(() => {
          return config.connections.resolveExisting(candidate);
        });

        expect(error).toBeInstanceOf(ConflictError);
        expect(error).toMatchObject({ hint: expect.stringContaining("Choose another slug") });
      });
    });

    describe("when the file the connection would go to is taken", () => {
      it("asks for another slug, naming no flag", () => {
        const config = aConfig({
          connections: { "acme-sso.json": anAcmeSsoConnection({ slug: "something-else" }) },
        });

        const error = thrownBy(() => {
          return config.connections.resolveExisting(ACME_SSO);
        });

        expect(error).toBeInstanceOf(ConflictError);
        expect(error).toMatchObject({
          hint: "Rename or remove that file, or choose another slug, then run the command again.",
        });
      });
    });
  });
});

describe("Connections.resolveBySlug", () => {
  /**
   * The `acme-sso` connection as the file holds it.
   */
  const ACME_SSO_ON_FILE = anOidcConnection({
    slug: "acme-sso",
    display_name: "Acme SSO",
    oidc: { scopes: ["openid", "email"] },
  });

  it.each([
    ["is the single connection that declares the slug", "acme-sso", undefined, ACME_SSO_FILE],
    ["is nothing for a slug that is free", "other-sso", undefined, undefined],
    [
      "accepts the issuer the connection was written with",
      "acme-sso",
      ACME_SSO_ISSUER,
      ACME_SSO_FILE,
    ],
  ])("%s", (_claim, slug, given, path) => {
    const config = aConfig({ connections: { "acme-sso.json": ACME_SSO_ON_FILE } });

    const named = config.connections.resolveBySlug(slug, given);

    expect(named?.path).toBe(path);
  });

  it.each([
    [
      "refuses two connections that declare the same slug",
      { "acme-sso-copy.json": ACME_SSO_ON_FILE, "acme-sso.json": ACME_SSO_ON_FILE },
      undefined,
      `More than one connection is named acme-sso: ${IDPS}/acme-sso-copy.json, ${ACME_SSO_FILE}`,
    ],
    [
      "refuses another issuer, even one that differs by a trailing slash",
      { "acme-sso.json": ACME_SSO_ON_FILE },
      "https://sso.acme.example/",
      `${ACME_SSO_FILE} is already named acme-sso and connects to ${ACME_SSO_ISSUER}, not https://sso.acme.example/`,
    ],
    [
      "refuses a connection that has no issuer at all",
      { "acme-sso.json": { slug: "acme-sso", protocol: "oidc", display_name: "Acme SSO" } },
      "https://a.example",
      `${ACME_SSO_FILE} is already named acme-sso and is not an OIDC connection to https://a.example`,
    ],
  ])("%s", (_claim, connections, given, message) => {
    const config = aConfig({ connections });

    const error = thrownBy(() => {
      return config.connections.resolveBySlug("acme-sso", given);
    });

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ message });
  });

  describe("when the issuer given is another", () => {
    it("states both issuers for a --json reader", () => {
      const config = aConfig({ connections: { "acme-sso.json": ACME_SSO_ON_FILE } });

      const error = thrownBy(() => {
        return config.connections.resolveBySlug("acme-sso", "https://sso.other.example");
      });

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        details: {
          file: ACME_SSO_FILE,
          slug: "acme-sso",
          issuer: "https://sso.other.example",
          existing_issuer: ACME_SSO_ISSUER,
        },
      });
    });
  });
});
