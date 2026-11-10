import { describe, expect, it } from "vitest";

import {
  AmbiguousSchemaError,
  BrokenFlowsError,
  NoSignInLeftError,
  RefusedEditError,
  SchemaNotFoundError,
  ZitadelConfig,
} from "@/lib/zitadel";
import { aConfig, authMethods, aUserSchema } from "@tests/helpers/config";
import {
  aFlowOffering,
  aMethodEdit,
  aSchemaEdit,
  aSchemaListing,
  aUserSchemaWithout,
  HUMAN_USER,
} from "@tests/helpers/schemas";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The file name of the schema in these tests, which names it.
 */
const SCHEMA_FILE = "customers.json";

/**
 * Where the schema in these tests sits.
 */
const SCHEMA_PATH = `.zitadel/schemas/${SCHEMA_FILE}`;

/**
 * The file name of the first flow in these tests.
 */
const FLOW_FILE = "login.json";

/**
 * Where the first flow in these tests sits.
 */
const FLOW_PATH = `.zitadel/flows/${FLOW_FILE}`;

/**
 * The file name of a second flow.
 */
const OTHER_FLOW_FILE = "flow-1.json";

/**
 * A schema whose file name is another schema's objectType.
 */
const CUSTOMER_FILE = ".zitadel/schemas/customer.json";

/**
 * A schema whose objectType is another schema's file name.
 */
const CUSTOMERS_FILE = ".zitadel/schemas/customers.json";

/**
 * A schema no other schema's objectType shadows.
 */
const EMPLOYEES_FILE = ".zitadel/schemas/employees.json";

/**
 * Three schemas, where `customer` is one's file name and the other's
 * objectType.
 */
const SEVERAL_SCHEMAS = {
  schemas: {
    "customer.json": aUserSchema({ objectType: "staff" }),
    "customers.json": aUserSchema({ objectType: "customer" }),
    "employees.json": aUserSchema({ objectType: "employee" }),
  },
};

/**
 * What a flow names when it runs against a schema other than the one in these
 * tests.
 */
const OTHER_SCHEMA = "staff";

/**
 * A flow whose login journey collects a password.
 */
const PASSWORD_FLOW = {
  name: "password-login",
  status: "active",
  user_schema: HUMAN_USER,
  purposes: { login: "password" },
  steps: [{ name: "password", fields: ["x-auth-methods#password"] }],
};

/**
 * A flow whose login journey offers a passkey.
 */
const PASSKEY_FLOW = {
  name: "passkey-login",
  status: "active",
  user_schema: HUMAN_USER,
  purposes: { login: "passkey" },
  steps: [{ name: "passkey", actions: [{ name: "passkey", kind: "passkey" }] }],
};

/**
 * A flow whose login journey asks for an identifier, then a password.
 */
const LOGIN_FLOW = {
  name: "login",
  status: "active",
  user_schema: HUMAN_USER,
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: ["email"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "password" } },
    },
    {
      name: "password",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
};

/**
 * What every warning about who can still sign in is.
 */
const WARNING = "warning";

describe("Schemas.enable", () => {
  it("switches only the named method", () => {
    const methods = { password: { enabled: true }, passkey: { enabled: false } };
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": methods }) },
    });
    const schema = config.schemas.resolve();

    const change = config.schemas.enable(schema, "passkey");

    expect(change.after.schemas.resolve().body["x-auth-methods"]).toEqual({
      password: { enabled: true },
      passkey: { enabled: true },
    });
  });

  it("keeps the other methods as they are", () => {
    const methods = { passkey: { enabled: false }, sso: { enabled: true, providers: ["google"] } };
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": methods }) },
    });
    const schema = config.schemas.resolve();

    const change = config.schemas.enable(schema, "passkey");

    expect(change.after.schemas.resolve().body["x-auth-methods"]).toEqual({
      passkey: { enabled: true },
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("adds a method the schema does not mention", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const schema = config.schemas.resolve();

    const change = config.schemas.enable(schema, "passkey");

    expect(change.after.schemas.resolve().body["x-auth-methods"]).toMatchObject({
      passkey: { enabled: true },
    });
  });

  it("writes the schema", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const schema = config.schemas.resolve();

    const change = config.schemas.enable(schema, "passkey");

    expect(change.changedPaths).toEqual([SCHEMA_PATH]);
  });

  it("writes nothing for a method already on", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: LOGIN_FLOW },
    });
    const schema = config.schemas.resolve();

    const change = config.schemas.enable(schema, "password");

    expect(change.changed).toBe(false);
  });

  it("does not change the configuration it was given", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const schema = config.schemas.resolve();
    const before = structuredClone(schema.body);

    config.schemas.enable(schema, "passkey");

    expect(config.schemas.resolve().body).toEqual(before);
  });

  it("warns when no login flow offers the method it enabled", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: LOGIN_FLOW },
    });
    const schema = config.schemas.resolve();

    const change = config.schemas.enable(schema, "passkey");

    expect(change.notices).toEqual([
      {
        severity: WARNING,
        message: expect.stringContaining("No login flow for customers offers passkey yet."),
      },
    ]);
  });

  it.each([
    ["no", aUserSchemaWithout("x-identifier", { "x-auth-methods": authMethods("passkey") })],
    ["a blank", aUserSchema({ "x-auth-methods": authMethods("passkey"), "x-identifier": " " })],
  ])("refuses password on a schema with %s identifier", (_identifier, body) => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: body } });
    const schema = config.schemas.resolve();

    const error = thrownBy(() => {
      return config.schemas.enable(schema, "password");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: `${SCHEMA_PATH} has no x-identifier for password`,
      details: { file: SCHEMA_PATH, method: "password" },
    });
  });
});

describe("Schemas.disable", () => {
  it("switches only the named method", () => {
    const config = aConfig({
      schemas: {
        [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("password", "passkey") }),
      },
    });
    const schema = config.schemas.resolve();

    const change = config.schemas.disable(schema, "passkey");

    expect(change.after.schemas.resolve().body["x-auth-methods"]).toEqual({
      password: { enabled: true },
      passkey: { enabled: false },
    });
  });

  it("writes nothing for a method already off", () => {
    const methods = { password: { enabled: true }, passkey: { enabled: false } };
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": methods }) },
    });
    const schema = config.schemas.resolve();

    const change = config.schemas.disable(schema, "passkey");

    expect(change.changed).toBe(false);
  });

  it("refuses to turn off a method a login flow still uses", () => {
    const config = aConfig({
      schemas: {
        [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("password", "passkey") }),
      },
      flows: { [FLOW_FILE]: LOGIN_FLOW },
    });
    const schema = config.schemas.resolve();

    const error = thrownBy(() => {
      return config.schemas.disable(schema, "password");
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      details: { steps: [{ path: FLOW_PATH, step: "password" }] },
    });
  });

  it("refuses to turn off the last way to sign in", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const schema = config.schemas.resolve();

    const error = thrownBy(() => {
      return config.schemas.disable(schema, "password");
    });

    expect(error).toBeInstanceOf(NoSignInLeftError);
    expect(error).toMatchObject({
      disabling: "password",
      usable: ["password"],
      alternatives: ["passkey"],
    });
  });

  it("refuses a flow that still uses the method before the last way to sign in", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: LOGIN_FLOW },
    });
    const schema = config.schemas.resolve();

    const error = thrownBy(() => {
      return config.schemas.disable(schema, "password");
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
  });

  it("turns off the last way to sign in when forced", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const schema = config.schemas.resolve();

    const change = config.schemas.disable(schema, "password", { force: true });

    expect(change.after.schemas.resolve().body["x-auth-methods"]).toEqual({
      password: { enabled: false },
    });
  });

  it("warns that a schema left with no way in is managed only through the API", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const schema = config.schemas.resolve();

    const change = config.schemas.disable(schema, "password", { force: true });

    expect(change.notices).toEqual([
      {
        severity: WARNING,
        message:
          "customers is left with no way to sign in. Its users can only be managed through the API.",
      },
    ]);
  });
});

describe("Schemas.listReachableMethods", () => {
  it("counts only methods an active flow offers", () => {
    const config = aConfig({
      schemas: {
        [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("password", "passkey") }),
      },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const schema = config.schemas.resolve();

    const reachable = config.schemas.listReachableMethods(schema);

    expect(reachable).toEqual(["password"]);
  });

  it("is empty when the flow offers nothing the schema enables", () => {
    const methods = { password: { enabled: false }, passkey: { enabled: true } };
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": methods }) },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const schema = config.schemas.resolve();

    const reachable = config.schemas.listReachableMethods(schema);

    expect(reachable).toEqual([]);
  });

  it("counts SSO on a step that names a provider the schema enables", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["google"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["google"]) },
    });
    const schema = config.schemas.resolve();

    const reachable = config.schemas.listReachableMethods(schema);

    expect(reachable).toEqual(["sso"]);
  });

  it.each([
    ["a flow that is not active", aUserSchema(), { ...PASSWORD_FLOW, status: "draft" }],
    [
      "a flow that runs against another schema",
      aUserSchema(),
      { ...PASSWORD_FLOW, user_schema: OTHER_SCHEMA },
    ],
    [
      "SSO for a provider the schema does not enable",
      aSchemaListing(["google"]),
      aFlowOffering(["github"]),
    ],
  ])("does not count %s", (_case, body, flow) => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: body }, flows: { [FLOW_FILE]: flow } });
    const schema = config.schemas.resolve();

    const reachable = config.schemas.listReachableMethods(schema);

    expect(reachable).toEqual([]);
  });
});

describe("Schemas.assertSignInLeft", () => {
  describe("when the edit turns off the last way to sign in", () => {
    it("refuses it, naming the schema and what it turns off", () => {
      const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        config.schemas.assertSignInLeft(edit, "password", false);
      });

      expect(error).toBeInstanceOf(NoSignInLeftError);
      expect(error).toMatchObject({
        path: SCHEMA_PATH,
        schema: "customers",
        disabling: "password",
      });
    });

    it("offers every method the schema did not enable, leaving out the one turned off", () => {
      const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        config.schemas.assertSignInLeft(edit, "password", false);
      });

      expect(error).toBeInstanceOf(NoSignInLeftError);
      expect(error).toMatchObject({ alternatives: ["passkey"] });
    });

    it("names the methods the schema enabled before the change", () => {
      const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        config.schemas.assertSignInLeft(edit, "password", false);
      });

      expect(error).toBeInstanceOf(NoSignInLeftError);
      expect(error).toMatchObject({ usable: ["password"] });
    });

    it("makes the edit anyway when forced", () => {
      const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
      const edit = aMethodEdit(config, "password", false);

      const error = thrownBy(() => {
        config.schemas.assertSignInLeft(edit, "password", true);
      });

      expect(error).toBeUndefined();
    });
  });

  it.each([
    [
      "no identifier",
      aUserSchemaWithout("x-identifier", { "x-auth-methods": authMethods("passkey") }),
    ],
    [
      "a blank identifier",
      aUserSchema({ "x-auth-methods": authMethods("passkey"), "x-identifier": " " }),
    ],
  ])("does not offer password to a schema with %s", (_identifier, body) => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: body } });
    const edit = aMethodEdit(config, "passkey", false);

    const error = thrownBy(() => {
      config.schemas.assertSignInLeft(edit, "passkey", false);
    });

    expect(error).toBeInstanceOf(NoSignInLeftError);
    expect(error).toMatchObject({ alternatives: [] });
  });

  it("names the provider being removed", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aSchemaListing(["google"]) } });
    const edit = aSchemaEdit(config, (schema) => {
      return schema.withoutProvider("google").document;
    });

    const error = thrownBy(() => {
      config.schemas.assertSignInLeft(edit, "google", false);
    });

    expect(error).toBeInstanceOf(NoSignInLeftError);
    expect(error).toMatchObject({ disabling: "google" });
  });

  it("allows an edit that leaves another way in", () => {
    const config = aConfig({
      schemas: {
        [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("password", "passkey") }),
      },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      config.schemas.assertSignInLeft(edit, "password", false);
    });

    expect(error).toBeUndefined();
  });

  it("allows an edit to a schema that had no way in already", () => {
    const methods = { password: { enabled: false }, otp: { enabled: true } };
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": methods }) },
    });
    const edit = aMethodEdit(config, "passkey", false);

    const error = thrownBy(() => {
      config.schemas.assertSignInLeft(edit, "passkey", false);
    });

    expect(error).toBeUndefined();
  });

  it.each([
    ["SSO without a provider", { sso: { enabled: true } }],
    ["a method the login engine cannot serve", { otp: { enabled: true } }],
  ])("does not count %s as a way in", (_case, others) => {
    const methods = { password: { enabled: true }, ...others };
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": methods }) },
    });
    const edit = aMethodEdit(config, "password", false);

    const error = thrownBy(() => {
      config.schemas.assertSignInLeft(edit, "password", false);
    });

    expect(error).toBeInstanceOf(NoSignInLeftError);
  });
});

describe("Schemas.describeSignIn", () => {
  it("says nothing when an enabled method is offered", () => {
    const config = aConfig({
      schemas: {
        [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": { password: { enabled: false } } }),
      },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "password", true);

    const notices = config.schemas.describeSignIn(edit, "password");

    expect(notices).toEqual([]);
  });

  it("says no login flow offers a method that was enabled, and where to offer it", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "passkey", true);

    const notices = config.schemas.describeSignIn(edit, "passkey");

    expect(notices).toEqual([
      {
        severity: WARNING,
        message: `No login flow for customers offers passkey yet. In ${FLOW_PATH}, add a "kind": "passkey" action to a step reached from purposes.login, plus a transition under the action's name. A "kind": "passkey_register" action does the same for sign-up. See .zitadel/flows/README.md.`,
      },
    ]);
  });

  it("says how to offer a password", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("passkey") }) },
      flows: { [FLOW_FILE]: PASSKEY_FLOW },
    });
    const edit = aMethodEdit(config, "password", true);

    const notices = config.schemas.describeSignIn(edit, "password");

    expect(notices).toEqual([
      {
        severity: WARNING,
        message: `No login flow for customers offers password yet. In ${FLOW_PATH}, add "x-auth-methods#password" to the fields of a step reached from purposes.login, with a "kind": "submit" action and a transition under its name. See .zitadel/flows/README.md.`,
      },
    ]);
  });

  it("names every login flow the method could go in", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: PASSWORD_FLOW, [OTHER_FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "passkey", true);

    const notices = config.schemas.describeSignIn(edit, "passkey");

    expect(notices).toContainEqual({
      severity: WARNING,
      message: expect.stringContaining(`In ${FLOW_PATH} or .zitadel/flows/${OTHER_FLOW_FILE}, add`),
    });
  });

  it("points at the flows directory when no flow signs anyone in", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: { ...PASSWORD_FLOW, status: "draft" } },
    });
    const edit = aMethodEdit(config, "passkey", true);

    const notices = config.schemas.describeSignIn(edit, "passkey");

    expect(notices).toContainEqual({
      severity: WARNING,
      message: expect.stringContaining(
        "In an active login flow for customers in .zitadel/flows/, add",
      ),
    });
  });

  it("says nobody can sign in when no flow offers any method the schema enables", () => {
    const config = aConfig({
      schemas: {
        [SCHEMA_FILE]: aUserSchema({ "x-auth-methods": authMethods("password", "passkey") }),
      },
      flows: { [FLOW_FILE]: PASSKEY_FLOW },
    });
    const edit = aMethodEdit(config, "passkey", false);

    const notices = config.schemas.describeSignIn(edit);

    expect(notices).toEqual([
      {
        severity: WARNING,
        message:
          "No active login flow for customers offers a method it enables, so nobody can sign in until one does.",
      },
    ]);
  });

  it("says a schema left with no way in is managed only through the API", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

    const notices = config.schemas.describeSignIn(edit);

    expect(notices).toEqual([
      {
        severity: WARNING,
        message:
          "customers is left with no way to sign in. Its users can only be managed through the API.",
      },
    ]);
  });
});

describe("Schemas.describeSignIn for a preview", () => {
  it("says a schema would be left with no way in", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aUserSchema() },
      flows: { [FLOW_FILE]: PASSWORD_FLOW },
    });
    const edit = aMethodEdit(config, "password", false);

    const notices = config.schemas.describeSignIn(edit, undefined, true);

    expect(notices).toEqual([
      {
        severity: WARNING,
        message:
          "customers would be left with no way to sign in. Its users can only be managed through the API.",
      },
    ]);
  });

  it("says it as it will be when the disable is a dry run", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const schema = config.schemas.resolve();

    const change = config.schemas.disable(schema, "password", { force: true, dryRun: true });

    expect(change.notices[0]?.message).toContain("customers would be left with no way to sign in");
  });
});

describe("Schemas.removesLastWayIn", () => {
  it("is true for an edit that takes the last way in", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const edit = aMethodEdit(config, "password", false);

    expect(config.schemas.removesLastWayIn(edit)).toBe(true);
  });

  it("is false for an edit that adds a way in", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });
    const edit = aMethodEdit(config, "passkey", true);

    expect(config.schemas.removesLastWayIn(edit)).toBe(false);
  });
});

describe("Schemas.resolve", () => {
  describe("with one schema", () => {
    it("picks it when no name is given", () => {
      const config = aConfig({ schemas: { [SCHEMA_FILE]: aUserSchema() } });

      const schema = config.schemas.resolve();

      expect(schema.path).toBe(SCHEMA_PATH);
    });
  });

  describe("with several schemas", () => {
    it.each([
      ["its file name", "employees", EMPLOYEES_FILE],
      ["its objectType, as a flow's user_schema names it", "employee", EMPLOYEES_FILE],
      ["<file>.json, which never matches an objectType", "customer.json", CUSTOMER_FILE],
      ["a path to its file", ".zitadel/schemas/employees.json", EMPLOYEES_FILE],
    ])("picks the schema by %s", (_how, requested, path) => {
      const config = aConfig(SEVERAL_SCHEMAS);

      const schema = config.schemas.resolve(requested);

      expect(schema.path).toBe(path);
    });

    it("refuses a name more than one schema answers to, naming every one", () => {
      const config = aConfig(SEVERAL_SCHEMAS);

      const error = thrownBy(() => {
        return config.schemas.resolve("customer");
      });

      expect(error).toBeInstanceOf(AmbiguousSchemaError);
      expect(error).toMatchObject({
        requested: "customer",
        details: { requested: "customer", candidates: ["customer", "customers"] },
      });
    });

    it("refuses to guess when no name is given, naming every schema", () => {
      const config = aConfig(SEVERAL_SCHEMAS);

      const error = thrownBy(() => {
        return config.schemas.resolve();
      });

      expect(error).toBeInstanceOf(AmbiguousSchemaError);
      expect(error).toMatchObject({
        requested: undefined,
        candidates: config.schemas.all,
        details: { requested: null },
      });
    });

    it("refuses a name no schema has, without its .json", () => {
      const config = aConfig(SEVERAL_SCHEMAS);

      const error = thrownBy(() => {
        return config.schemas.resolve("staff.json");
      });

      expect(error).toBeInstanceOf(SchemaNotFoundError);
      expect(error).toMatchObject({
        message: "No user schema is named staff",
        requested: "staff",
        details: { requested: "staff", known: ["customer", "customers", "employees"] },
      });
    });
  });

  describe("with no schema", () => {
    it("refuses whatever is asked for", () => {
      const config = ZitadelConfig.empty();

      const error = thrownBy(() => {
        return config.schemas.resolve("customers");
      });

      expect(error).toBeInstanceOf(SchemaNotFoundError);
      expect(error).toMatchObject({
        message: "There is no user schema under .zitadel/schemas",
        known: [],
      });
    });
  });
});

describe("Schemas.nameUniquely", () => {
  it.each([
    ["its file name", EMPLOYEES_FILE, "employees"],
    [
      "<file>.json, when its file name is another schema's objectType",
      CUSTOMER_FILE,
      "customer.json",
    ],
  ])("names a schema by %s", (_how, path, name) => {
    const config = aConfig(SEVERAL_SCHEMAS);
    const schemas = config.schemas.all.filter((schema) => {
      return schema.path === path;
    });

    const names = schemas.map((schema) => {
      return config.schemas.nameUniquely(schema);
    });

    expect(names).toEqual([name]);
  });

  it("keeps the bare name of a schema whose objectType is its own file name", () => {
    const config = aConfig({
      schemas: { "customer.json": aUserSchema({ objectType: "customer" }) },
    });

    const names = config.schemas.all.map((schema) => {
      return config.schemas.nameUniquely(schema);
    });

    expect(names).toEqual(["customer"]);
  });
});

describe("Schemas.locate", () => {
  describe("when a file holds the handle", () => {
    it("is that file", () => {
      const config = aConfig(SEVERAL_SCHEMAS);

      const path = config.schemas.locate("customer");

      expect(path).toBe(CUSTOMERS_FILE);
    });
  });

  describe("when no file holds the handle", () => {
    it("is <handle>.json", () => {
      const config = ZitadelConfig.empty();

      const path = config.schemas.locate("human-user");

      expect(path).toBe(".zitadel/schemas/human-user.json");
    });
  });
});

describe("Schemas.placeRevision", () => {
  describe("when a file holds the handle", () => {
    it("replaces that file rather than writing a second one", () => {
      const config = aConfig(SEVERAL_SCHEMAS);

      const change = config.schemas.placeRevision(
        "customer",
        aUserSchema({ objectType: "customer", type: "object" }),
      );

      expect(change.changedPaths).toEqual([CUSTOMERS_FILE]);
    });
  });
});
