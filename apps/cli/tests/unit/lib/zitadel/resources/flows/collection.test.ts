import { describe, expect, it } from "vitest";

import { type ConfigOptions, type UserSchema, ZitadelConfig } from "@/lib/zitadel";
import type { JsonObject } from "@/lib/zitadel/types";
import { slug } from "@tests/helpers/idp-values";
import { loginFlow } from "@tests/helpers/local-project";

const CUSTOMERS = ".zitadel/schemas/customers.json";

/** The configuration with these schemas and flows, each keyed by its file name. */
function configOf(
  schemas: Readonly<Record<string, JsonObject>>,
  flows: Readonly<Record<string, JsonObject>>,
  options: ConfigOptions = {},
): ZitadelConfig {
  return ZitadelConfig.of(
    {
      schemas: Object.entries(schemas).map(([name, body]) => {
        return { path: `.zitadel/schemas/${name}.json`, body };
      }),
      flows: Object.entries(flows).map(([name, body]) => {
        return { path: `.zitadel/flows/${name}.json`, body };
      }),
      connections: [],
      policies: [],
      branding: [],
    },
    options,
  );
}

/** A flow that names its schema by `reference`. */
function flowFor(reference: string): JsonObject {
  return { user_schema: reference };
}

/** The schema named `customers`. */
function customersIn(config: ZitadelConfig): UserSchema {
  const schema = config.schemas.get(CUSTOMERS);
  if (schema === undefined) {
    throw new Error("the configuration has no customers schema");
  }
  return schema;
}

/** The names of the flows that run against `customers`. */
function flowsForCustomers(config: ZitadelConfig): readonly string[] {
  return config.flows.for(customersIn(config)).map((flow) => {
    return flow.name;
  });
}

/** The ids the customers schema was published as. */
function published(...ids: string[]): ConfigOptions {
  return { published: new Map([[CUSTOMERS, ids]]) };
}

describe("Flows.for", () => {
  it("matches flows by the schema's objectType", () => {
    const config = configOf(
      {
        customers: { objectType: "customer", $id: "https://a.test/customers.json" },
        staff: { objectType: "employee" },
      },
      { customers: flowFor("customer"), staff: flowFor("employee") },
    );

    expect(flowsForCustomers(config)).toEqual(["customers"]);
  });

  it("does not match another schema's objectType", () => {
    const config = configOf(
      { customers: { objectType: "customer" } },
      { staff: flowFor("employee") },
    );

    expect(flowsForCustomers(config)).toEqual([]);
  });

  it("matches flows by the schema's $id", () => {
    const config = configOf(
      {
        customers: { $id: "https://a.test/customers.json" },
        staff: { $id: "https://a.test/staff.json" },
      },
      {
        customers: flowFor("https://a.test/customers.json"),
        staff: flowFor("https://a.test/staff.json"),
      },
    );

    expect(flowsForCustomers(config)).toEqual(["customers"]);
  });

  it("does not match on the file name when the $id disagrees", () => {
    const config = configOf(
      { customers: { $id: "https://a.test/customers.json" } },
      { other: flowFor("https://elsewhere.test/customers.json") },
    );

    expect(flowsForCustomers(config)).toEqual([]);
  });

  it("falls back to the file name for a schema without an $id", () => {
    const config = configOf({ customers: {} }, { login: flowFor("https://a.test/customers.json") });

    expect(flowsForCustomers(config)).toEqual(["login"]);
  });

  it("does not match a file name that only ends the same way", () => {
    const config = configOf(
      { customers: {} },
      { login: flowFor("https://a.test/vip-customers.json") },
    );

    expect(flowsForCustomers(config)).toEqual([]);
  });

  it("matches the id the schema was published as", () => {
    const config = configOf(
      { customers: { $id: "https://a.test/customers.json" } },
      { login: flowFor("sch_PUBLISHED") },
      published("sch_PUBLISHED"),
    );

    expect(flowsForCustomers(config)).toEqual(["login"]);
  });

  it("still matches a flow an interrupted deploy left on the previous id", () => {
    const config = configOf(
      { customers: { $id: "https://a.test/customers.json" } },
      { login: flowFor("sch_OLD") },
      published("sch_NEW", "sch_OLD"),
    );

    expect(flowsForCustomers(config)).toEqual(["login"]);
  });

  it("does not match a published id without being told it", () => {
    const config = configOf(
      { customers: { $id: "https://a.test/customers.json" } },
      { login: flowFor("sch_PUBLISHED") },
    );

    expect(flowsForCustomers(config)).toEqual([]);
  });

  it("does not match a flow that names no schema", () => {
    const config = configOf({ customers: { objectType: "customer" } }, { login: {} });

    expect(flowsForCustomers(config)).toEqual([]);
  });
});

describe("Flows.schemaOf", () => {
  it("is the schema a flow names", () => {
    const config = configOf(
      { customers: { objectType: "customer" }, staff: { objectType: "employee" } },
      { login: flowFor("employee") },
    );
    const [flow] = config.flows.all;

    expect(flow === undefined ? undefined : config.flows.schemaOf(flow)?.name).toBe("staff");
  });

  it("prefers a schema the flow names outright over one whose file name it ends with", () => {
    const config = configOf(
      { customers: {}, staff: { $id: "https://a.test/customers.json" } },
      { login: flowFor("https://a.test/customers.json") },
    );
    const [flow] = config.flows.all;

    expect(flow === undefined ? undefined : config.flows.schemaOf(flow)?.name).toBe("staff");
  });

  it.each([
    ["names no schema", {}],
    ["names an empty schema", { user_schema: "" }],
    ["names a schema the project does not have", { user_schema: "sch_PUBLISHED" }],
  ])("is undefined for a flow that %s", (_, body) => {
    const config = configOf({ customers: { objectType: "customer" } }, { login: body });
    const [flow] = config.flows.all;

    expect(flow === undefined ? "no flow" : config.flows.schemaOf(flow)).toBeUndefined();
  });
});

describe("Flows.forSso", () => {
  const login = (over: JsonObject = {}): JsonObject => {
    return { ...loginFlow("customers"), user_schema: "customers", ...over };
  };
  const customers = (methods: JsonObject = {}): JsonObject => {
    return {
      objectType: "customers",
      properties: { email: { type: "string" } },
      "x-auth-methods": { password: { enabled: true }, ...methods },
    };
  };

  it("is the flows that run against the schema", () => {
    const config = configOf({ customers: customers() }, { "customers-login": login() });

    expect(
      config.flows.forSso(customersIn(config)).map((flow) => {
        return flow.path;
      }),
    ).toEqual([".zitadel/flows/customers-login.json"]);
  });

  it("refuses a schema no login flow runs against, naming it", () => {
    const config = configOf({ customers: customers() }, {});

    expect(() => {
      config.flows.forSso(customersIn(config));
    }).toThrow(
      expect.objectContaining({
        name: "NotFoundError",
        message: "No login flow runs against customers",
        details: { schema: CUSTOMERS },
      }),
    );
  });

  it("refuses a schema whose sso method is not the shape the edit writes", () => {
    const config = configOf(
      { customers: customers({ sso: true }) },
      { "customers-login": login() },
    );

    expect(() => {
      config.flows.forSso(customersIn(config));
    }).toThrow(
      expect.objectContaining({
        name: "RefusedEditError",
        message: `${CUSTOMERS}: x-auth-methods.sso is not an object`,
      }),
    );
  });

  it("refuses a flow that already has errors once the slug is known", () => {
    const flow = login();
    const steps = (flow.steps as ReadonlyArray<Record<string, unknown>>).map((step) => {
      if (step.name !== "identifier") {
        return step;
      }
      return { ...step, transitions: { submit: { target: "nowhere" } } };
    });
    const config = configOf({ customers: customers() }, { "customers-login": login({ steps }) });

    expect(() => {
      config.flows.forSso(customersIn(config), slug("acme-sso"));
    }).toThrow(expect.objectContaining({ name: "BrokenFlowsError" }));
  });

  it("does not judge the flows before the slug is known", () => {
    const flow = login();
    const steps = (flow.steps as ReadonlyArray<Record<string, unknown>>).map((step) => {
      if (step.name !== "identifier") {
        return step;
      }
      return { ...step, transitions: { submit: { target: "nowhere" } } };
    });
    const config = configOf({ customers: customers() }, { "customers-login": login({ steps }) });

    expect(config.flows.forSso(customersIn(config))).toHaveLength(1);
  });

  it("refuses a flow whose steps are not the shape the edit writes", () => {
    const config = configOf(
      { customers: customers() },
      { "customers-login": login({ steps: {} }) },
    );

    expect(() => {
      config.flows.forSso(customersIn(config));
    }).toThrow(
      expect.objectContaining({
        name: "RefusedEditError",
        message: ".zitadel/flows/customers-login.json: steps is not a list",
      }),
    );
  });
});

describe("Flows.pathFor", () => {
  describe("when a file holds the handle", () => {
    it("is that file, whatever it is called", () => {
      const config = configOf({}, { login: { name: "default-login" } });

      const path = config.flows.pathFor("default-login");

      expect(path).toBe(".zitadel/flows/login.json");
    });
  });

  describe("when no file holds the handle", () => {
    it("is <handle>.json", () => {
      const config = configOf({}, {});

      const path = config.flows.pathFor("default-login");

      expect(path).toBe(".zitadel/flows/default-login.json");
    });
  });
});

describe("Flows.revision", () => {
  describe("when a file holds the handle", () => {
    it("replaces that file rather than writing a second one", () => {
      const config = configOf({}, { login: { name: "default-login" } });

      const change = config.flows.revision("default-login", { name: "default-login", steps: [] });

      expect(change.changedPaths).toEqual([".zitadel/flows/login.json"]);
    });
  });
});
