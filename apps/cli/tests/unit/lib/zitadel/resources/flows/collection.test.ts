import { describe, expect, it } from "vitest";

import { BrokenFlowsError, type ConfigOptions, NotFoundError, UserSchema } from "@/lib/zitadel";
import type { JsonObject } from "@/lib/zitadel/types";
import {
  aConfig,
  anOidcConnection,
  aFile,
  aLoginFlow,
  aUserSchema,
  type DocumentsByName,
} from "@tests/helpers/config";
import { aFlow, aFlowBody, withStep } from "@tests/helpers/flows";
import { aFlowOffering, aSchemaListing } from "@tests/helpers/schemas";
import { slug } from "@tests/helpers/idp-values";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The file name of the schema the tests ask about.
 */
const CUSTOMERS_FILE = "customers.json";

/**
 * Where that schema sits.
 */
const CUSTOMERS = ".zitadel/schemas/customers.json";

/**
 * The file name of the login flow that runs against `customers`.
 */
const CUSTOMERS_LOGIN_FILE = "customers-login.json";

/**
 * The `$id` the customers schema declares.
 */
const CUSTOMERS_ID = "https://a.test/customers.json";

/**
 * The customers schema, read from {@link CUSTOMERS}.
 *
 * @param body - What the file holds.
 * @returns The schema.
 */
function customers(body: JsonObject): UserSchema {
  return UserSchema.of(aFile("schemas", CUSTOMERS_FILE, body));
}

/**
 * A flow that names its schema by `reference`.
 *
 * @param reference - What its `user_schema` says.
 * @returns The flow document.
 */
function flowFor(reference: string): JsonObject {
  return aFlowBody({ user_schema: reference });
}

/**
 * The ids the customers schema was published as.
 *
 * @param ids - The ids, newest first.
 * @returns The options that say so.
 */
function published(...ids: string[]): ConfigOptions {
  return { published: new Map([[CUSTOMERS, ids]]) };
}

/**
 * A schema `sso enable` can offer a provider for: `customers`, signing in by
 * password.
 *
 * @param methods - `x-auth-methods` entries to set besides password.
 * @returns The schema document.
 */
function ssoSchema(methods: JsonObject = {}): JsonObject {
  return aUserSchema({
    objectType: "customers",
    properties: { email: { type: "string" } },
    "x-auth-methods": { password: { enabled: true }, ...methods },
  });
}

/**
 * A configuration in which a flow names the customers schema.
 */
type NamedBy = Readonly<{
  /**
   * How the flow names it.
   */
  by: string;
  /**
   * The customers schema.
   */
  schema: JsonObject;
  /**
   * The project's other schemas, by file name.
   */
  others: DocumentsByName;
  /**
   * The project's flows, by file name; the customers one is `customers.json`.
   */
  flows: DocumentsByName;
  /**
   * What is known beyond the files.
   */
  options: ConfigOptions;
}>;

/**
 * The scaffolded login flow, running against `customers` by its objectType.
 */
const CUSTOMERS_LOGIN = aLoginFlow({ userSchema: "customers" });

/**
 * {@link CUSTOMERS_LOGIN} with its identifier step submitting to a step the
 * flow does not have, which the server's flow rules refuse.
 */
const BROKEN_LOGIN = withStep(CUSTOMERS_LOGIN, "identifier", (step) => {
  return { ...step, transitions: { submit: { target: "nowhere" } } };
});

describe("Flows.findForSchema", () => {
  it.each<NamedBy>([
    {
      by: "the schema's objectType",
      schema: aUserSchema({ objectType: "customer", $id: CUSTOMERS_ID }),
      others: { "staff.json": aUserSchema({ objectType: "employee" }) },
      flows: { "customers.json": flowFor("customer"), "staff.json": flowFor("employee") },
      options: {},
    },
    {
      by: "the schema's $id",
      schema: aUserSchema({ $id: CUSTOMERS_ID }),
      others: { "staff.json": aUserSchema({ $id: "https://a.test/staff.json" }) },
      flows: {
        "customers.json": flowFor(CUSTOMERS_ID),
        "staff.json": flowFor("https://a.test/staff.json"),
      },
      options: {},
    },
    {
      by: "the file name of a schema without an $id",
      schema: aUserSchema(),
      others: {},
      flows: { "customers.json": flowFor("https://a.test/customers.json") },
      options: {},
    },
    {
      by: "the id the schema was published as",
      schema: aUserSchema({ $id: CUSTOMERS_ID }),
      others: {},
      flows: { "customers.json": flowFor("sch_PUBLISHED") },
      options: published("sch_PUBLISHED"),
    },
    {
      by: "the previous id, left by an interrupted deploy",
      schema: aUserSchema({ $id: CUSTOMERS_ID }),
      others: {},
      flows: { "customers.json": flowFor("sch_OLD") },
      options: published("sch_NEW", "sch_OLD"),
    },
  ])("matches a flow that names it by $by", ({ schema, others, flows, options }) => {
    const config = aConfig({ schemas: { [CUSTOMERS_FILE]: schema, ...others }, flows }, options);

    const matched = config.flows.findForSchema(customers(schema));

    expect(
      matched.map((flow) => {
        return flow.name;
      }),
    ).toEqual(["customers"]);
  });

  it.each([
    {
      names: "another schema's objectType",
      schema: aUserSchema({ objectType: "customer" }),
      flow: flowFor("employee"),
      options: {},
    },
    {
      names: "the file name of a schema whose $id disagrees",
      schema: aUserSchema({ $id: CUSTOMERS_ID }),
      flow: flowFor("https://elsewhere.test/customers.json"),
      options: {},
    },
    {
      names: "a file name that only ends the same way",
      schema: aUserSchema(),
      flow: flowFor("https://a.test/vip-customers.json"),
      options: {},
    },
    {
      names: "a published id it was not told of",
      schema: aUserSchema({ $id: CUSTOMERS_ID }),
      flow: flowFor("sch_PUBLISHED"),
      options: {},
    },
  ])("matches no flow that names $names", ({ schema, flow, options }) => {
    const config = aConfig(
      { schemas: { [CUSTOMERS_FILE]: schema }, flows: { "login.json": flow } },
      options,
    );

    const matched = config.flows.findForSchema(customers(schema));

    expect(matched).toEqual([]);
  });
});

describe("Flows.findSchemaOf", () => {
  it("is the schema a flow names", () => {
    const config = aConfig({
      schemas: {
        [CUSTOMERS_FILE]: aUserSchema({ objectType: "customer" }),
        "staff.json": aUserSchema({ objectType: "employee" }),
      },
    });

    const schema = config.flows.findSchemaOf(aFlow(flowFor("employee")));

    expect(schema?.name).toBe("staff");
  });

  it("prefers a schema the flow names outright over one whose file name it ends with", () => {
    const config = aConfig({
      schemas: {
        [CUSTOMERS_FILE]: aUserSchema(),
        "staff.json": aUserSchema({ $id: CUSTOMERS_ID }),
      },
    });

    const schema = config.flows.findSchemaOf(aFlow(flowFor(CUSTOMERS_ID)));

    expect(schema?.name).toBe("staff");
  });

  it("is undefined for a flow naming the URL of a schema that points at an external one", () => {
    const config = aConfig({
      schemas: {
        [CUSTOMERS_FILE]: {
          kind: "schema-url",
          url: "https://schemas.acme.test/customers.json",
        },
      },
    });

    const schema = config.flows.findSchemaOf(
      aFlow(flowFor("https://schemas.acme.test/customers.json")),
    );

    expect(schema).toBeUndefined();
  });

  it.each([
    ["names an empty schema", { user_schema: "" }],
    ["names a schema the project does not have", { user_schema: "sch_PUBLISHED" }],
  ])("is undefined for a flow that %s", (_, body) => {
    const config = aConfig({
      schemas: { [CUSTOMERS_FILE]: aUserSchema({ objectType: "customer" }) },
    });

    const schema = config.flows.findSchemaOf(aFlow(body));

    expect(schema).toBeUndefined();
  });
});

describe("Flows.resolveForSso", () => {
  it("is the flows that run against the schema", () => {
    const config = aConfig({
      schemas: { [CUSTOMERS_FILE]: ssoSchema() },
      flows: { [CUSTOMERS_LOGIN_FILE]: CUSTOMERS_LOGIN },
    });

    const flows = config.flows.resolveForSso(customers(ssoSchema()));

    expect(
      flows.map((flow) => {
        return flow.path;
      }),
    ).toEqual([".zitadel/flows/customers-login.json"]);
  });

  it("does not judge the flows before the slug is known", () => {
    const config = aConfig({
      schemas: { [CUSTOMERS_FILE]: ssoSchema() },
      flows: { [CUSTOMERS_LOGIN_FILE]: BROKEN_LOGIN },
    });

    const flows = config.flows.resolveForSso(customers(ssoSchema()));

    expect(flows).toHaveLength(1);
  });

  it("refuses a schema no login flow runs against, naming it", () => {
    const config = aConfig({ schemas: { [CUSTOMERS_FILE]: ssoSchema() } });

    const error = thrownBy(() => {
      return config.flows.resolveForSso(customers(ssoSchema()));
    });

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({
      message: "No login flow runs against customers",
      details: { schema: CUSTOMERS },
    });
  });

  it("refuses a flow that already has errors once the slug is known", () => {
    const config = aConfig({
      schemas: { [CUSTOMERS_FILE]: ssoSchema() },
      flows: { [CUSTOMERS_LOGIN_FILE]: BROKEN_LOGIN },
    });

    const error = thrownBy(() => {
      return config.flows.resolveForSso(customers(ssoSchema()), slug("acme-sso"));
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
  });
});

describe("Flows.locate", () => {
  describe("when a file holds the handle", () => {
    it("is that file, whatever it is called", () => {
      const config = aConfig({ flows: { "login.json": aFlowBody({ name: "default-login" }) } });

      const path = config.flows.locate("default-login");

      expect(path).toBe(".zitadel/flows/login.json");
    });
  });

  describe("when no file holds the handle", () => {
    it("is <handle>.json", () => {
      const config = aConfig();

      const path = config.flows.locate("default-login");

      expect(path).toBe(".zitadel/flows/default-login.json");
    });
  });
});

describe("Flows.placeRevision", () => {
  describe("when a file holds the handle", () => {
    it("replaces that file rather than writing a second one", () => {
      const config = aConfig({ flows: { "login.json": aFlowBody({ name: "default-login" }) } });

      const change = config.flows.placeRevision("default-login", aLoginFlow());

      expect(change.changedPaths).toEqual([".zitadel/flows/login.json"]);
    });
  });
});

describe("Flows.signUpGaps", () => {
  /**
   * The project's files: a schema that requires an email, a flow whose steps
   * are as given, and the connection `acme`, which maps no email.
   *
   * @param steps - The flow's steps; the first is where login starts.
   * @param connection - The connection `acme`, which by default maps no email.
   * @returns The configuration.
   */
  function configWith(
    steps: readonly JsonObject[],
    connection: JsonObject = anOidcConnection({ claim_mapping: {} }),
  ): ReturnType<typeof aConfig> {
    return aConfig({
      schemas: { "staff.json": aSchemaListing(["acme"], { required: ["email"] }) },
      flows: {
        "login.json": {
          ...aFlowOffering(["acme"]),
          purposes: { login: String(steps[0]?.name) },
          steps,
        },
      },
      connections: { "acme.json": connection },
    });
  }

  /**
   * The routes of a step that offers `acme`.
   */
  const OFFERING_ROUTES: JsonObject = {
    sso_authenticated: { target: "done" },
    sso_user_not_found: { target: "register-sso" },
    user_already_exists: { target: "sso-conflict" },
  };

  /**
   * The step that creates the user.
   */
  const REGISTER: JsonObject = { name: "register-sso", on_success: "create_user_with_sso" };

  it("reports a provider button on a step that also asks for the property", () => {
    const config = configWith([
      {
        name: "identifier",
        fields: ["email"],
        sso_providers: ["acme"],
        transitions: OFFERING_ROUTES,
      },
      REGISTER,
    ]);

    expect(
      config.flows.signUpGaps.map((gap) => {
        return [gap.step.name, gap.connection.slug, gap.path];
      }),
    ).toEqual([["register-sso", "acme", "email"]]);
  });

  it("reports nothing when the connection maps the property", () => {
    const config = configWith(
      [{ name: "identifier", sso_providers: ["acme"], transitions: OFFERING_ROUTES }, REGISTER],
      anOidcConnection({ claim_mapping: { email: "email" } }),
    );

    expect(config.flows.signUpGaps).toEqual([]);
  });

  it("reports nothing when the connection creates no users", () => {
    const config = configWith(
      [{ name: "identifier", sso_providers: ["acme"], transitions: OFFERING_ROUTES }, REGISTER],
      anOidcConnection({ claim_mapping: {}, provisioning: { creation: "disabled" } }),
    );

    expect(config.flows.signUpGaps).toEqual([]);
  });

  it("reports nothing when the step that creates the user asks for the property", () => {
    const config = configWith([
      { name: "identifier", sso_providers: ["acme"], transitions: OFFERING_ROUTES },
      { ...REGISTER, fields: ["email"] },
    ]);

    expect(config.flows.signUpGaps).toEqual([]);
  });

  it("reports nothing when the step a provider leads to does not create a user from SSO", () => {
    const config = configWith([
      { name: "identifier", sso_providers: ["acme"], transitions: OFFERING_ROUTES },
      { name: "register-sso" },
    ]);

    expect(config.flows.signUpGaps).toEqual([]);
  });

  it("reports nothing when an earlier step asks for the property", () => {
    const config = configWith([
      {
        name: "details",
        fields: ["email"],
        transitions: { submit: { target: "identifier" } },
      },
      { name: "identifier", sso_providers: ["acme"], transitions: OFFERING_ROUTES },
      REGISTER,
    ]);

    expect(config.flows.signUpGaps).toEqual([]);
  });

  it("reports nothing for an optional identifier a password would ask for", () => {
    const config = aConfig({
      schemas: {
        "staff.json": aSchemaListing(["acme"], {
          "x-identifier": "email",
          "x-auth-methods": {
            password: { enabled: true },
            sso: { enabled: true, providers: ["acme"] },
          },
        }),
      },
      flows: {
        "login.json": {
          ...aFlowOffering(["acme"]),
          steps: [
            { name: "identifier", sso_providers: ["acme"], transitions: OFFERING_ROUTES },
            REGISTER,
          ],
        },
      },
      connections: { "acme.json": anOidcConnection({ claim_mapping: {} }) },
    });

    expect(config.flows.signUpGaps).toEqual([]);
  });

  it("does not follow a transition that leaves the flow", () => {
    const config = configWith([
      {
        name: "identifier",
        sso_providers: ["acme"],
        transitions: {
          ...OFFERING_ROUTES,
          sso_user_not_found: { action: "switch", target: "register-sso" },
        },
      },
      REGISTER,
    ]);

    expect(config.flows.signUpGaps).toEqual([]);
  });
});
