import { describe, expect, it } from "vitest";

import {
  BrokenFlowsError,
  type ConfigOptions,
  NotFoundError,
  RefusedEditError,
  UserSchema,
} from "@/lib/zitadel";
import type { JsonObject } from "@/lib/zitadel/types";
import { aConfig, aFile, aLoginFlow, type DocumentsByName } from "@tests/helpers/config";
import { aFlow, withStep } from "@tests/helpers/flows";
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
  return { user_schema: reference };
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
  return {
    objectType: "customers",
    properties: { email: { type: "string" } },
    "x-auth-methods": { password: { enabled: true }, ...methods },
  };
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
      schema: { objectType: "customer", $id: CUSTOMERS_ID },
      others: { "staff.json": { objectType: "employee" } },
      flows: { "customers.json": flowFor("customer"), "staff.json": flowFor("employee") },
      options: {},
    },
    {
      by: "the schema's $id",
      schema: { $id: CUSTOMERS_ID },
      others: { "staff.json": { $id: "https://a.test/staff.json" } },
      flows: {
        "customers.json": flowFor(CUSTOMERS_ID),
        "staff.json": flowFor("https://a.test/staff.json"),
      },
      options: {},
    },
    {
      by: "the file name of a schema without an $id",
      schema: {},
      others: {},
      flows: { "customers.json": flowFor("https://a.test/customers.json") },
      options: {},
    },
    {
      by: "the id the schema was published as",
      schema: { $id: CUSTOMERS_ID },
      others: {},
      flows: { "customers.json": flowFor("sch_PUBLISHED") },
      options: published("sch_PUBLISHED"),
    },
    {
      by: "the previous id, left by an interrupted deploy",
      schema: { $id: CUSTOMERS_ID },
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
      schema: { objectType: "customer" },
      flow: flowFor("employee"),
      options: {},
    },
    {
      names: "the file name of a schema whose $id disagrees",
      schema: { $id: CUSTOMERS_ID },
      flow: flowFor("https://elsewhere.test/customers.json"),
      options: {},
    },
    {
      names: "a file name that only ends the same way",
      schema: {},
      flow: flowFor("https://a.test/vip-customers.json"),
      options: {},
    },
    {
      names: "a published id it was not told of",
      schema: { $id: CUSTOMERS_ID },
      flow: flowFor("sch_PUBLISHED"),
      options: {},
    },
    { names: "no schema", schema: { objectType: "customer" }, flow: {}, options: {} },
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
        [CUSTOMERS_FILE]: { objectType: "customer" },
        "staff.json": { objectType: "employee" },
      },
    });

    const schema = config.flows.findSchemaOf(aFlow(flowFor("employee")));

    expect(schema?.name).toBe("staff");
  });

  it("prefers a schema the flow names outright over one whose file name it ends with", () => {
    const config = aConfig({
      schemas: { [CUSTOMERS_FILE]: {}, "staff.json": { $id: CUSTOMERS_ID } },
    });

    const schema = config.flows.findSchemaOf(aFlow(flowFor(CUSTOMERS_ID)));

    expect(schema?.name).toBe("staff");
  });

  it.each([
    ["names no schema", {}],
    ["names an empty schema", { user_schema: "" }],
    ["names a schema the project does not have", { user_schema: "sch_PUBLISHED" }],
  ])("is undefined for a flow that %s", (_, body) => {
    const config = aConfig({ schemas: { [CUSTOMERS_FILE]: { objectType: "customer" } } });

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

  it("refuses a schema whose sso method is not the shape the edit writes", () => {
    const schema = ssoSchema({ sso: true });
    const config = aConfig({
      schemas: { [CUSTOMERS_FILE]: schema },
      flows: { [CUSTOMERS_LOGIN_FILE]: CUSTOMERS_LOGIN },
    });

    const error = thrownBy(() => {
      return config.flows.resolveForSso(customers(schema));
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({ message: `${CUSTOMERS}: x-auth-methods.sso is not an object` });
  });

  it("refuses a flow whose steps are not the shape the edit writes", () => {
    const config = aConfig({
      schemas: { [CUSTOMERS_FILE]: ssoSchema() },
      flows: { [CUSTOMERS_LOGIN_FILE]: { ...CUSTOMERS_LOGIN, steps: {} } },
    });

    const error = thrownBy(() => {
      return config.flows.resolveForSso(customers(ssoSchema()));
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: ".zitadel/flows/customers-login.json: steps is not a list",
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
      const config = aConfig({ flows: { "login.json": { name: "default-login" } } });

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
      const config = aConfig({ flows: { "login.json": { name: "default-login" } } });

      const change = config.flows.placeRevision("default-login", {
        name: "default-login",
        steps: [],
      });

      expect(change.changedPaths).toEqual([".zitadel/flows/login.json"]);
    });
  });
});
