import { describe, expect, it } from "vitest";

import { type UserSchema, ZitadelConfig } from "@/lib/zitadel";
import type { JsonObject } from "@/lib/zitadel/types";

/** The configuration with these schemas and flows, each keyed by its file name. */
function configOf(
  schemas: Readonly<Record<string, JsonObject>>,
  flows: Readonly<Record<string, JsonObject>>,
): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: Object.entries(schemas).map(([name, body]) => {
      return { path: `.zitadel/schemas/${name}.json`, body };
    }),
    flows: Object.entries(flows).map(([name, body]) => {
      return { path: `.zitadel/flows/${name}.json`, body };
    }),
    connections: [],
    policies: [],
    branding: [],
  });
}

/** A flow that names its schema by `reference`. */
function flowFor(reference: string): JsonObject {
  return { user_schema: reference };
}

/** The schema named `customers`. */
function customersIn(config: ZitadelConfig): UserSchema {
  const schema = config.schema(".zitadel/schemas/customers.json");
  if (schema === undefined) {
    throw new Error("the configuration has no customers schema");
  }
  return schema;
}

/** The names of the flows that run against `customers`. */
function flowsForCustomers(config: ZitadelConfig): readonly string[] {
  return config.flowsFor(customersIn(config)).map((flow) => {
    return flow.name;
  });
}

describe("ZitadelConfig.flowsFor", () => {
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

  it("does not match a flow that names no schema", () => {
    const config = configOf({ customers: { objectType: "customer" } }, { login: {} });

    expect(flowsForCustomers(config)).toEqual([]);
  });
});

describe("ZitadelConfig.schemaOf", () => {
  it("is the schema a flow names", () => {
    const config = configOf(
      { customers: { objectType: "customer" }, staff: { objectType: "employee" } },
      { login: flowFor("employee") },
    );
    const [flow] = config.flows;

    expect(flow === undefined ? undefined : config.schemaOf(flow)?.name).toBe("staff");
  });

  it.each([
    ["names no schema", {}],
    ["names an empty schema", { user_schema: "" }],
    ["names a schema the project does not have", { user_schema: "sch_PUBLISHED" }],
  ])("is undefined for a flow that %s", (_, body) => {
    const config = configOf({ customers: { objectType: "customer" } }, { login: body });
    const [flow] = config.flows;

    expect(flow === undefined ? "no flow" : config.schemaOf(flow)).toBeUndefined();
  });
});
