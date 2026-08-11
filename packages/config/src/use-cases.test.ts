import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETUP_USE_CASE,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
  SETUP_PRESETS,
  SETUP_USE_CASES,
} from "./defaults.js";
import { flowConfigSchema, schemaConfigSchema } from "./schemas.js";
import { validateFlowDefinition } from "./validate.js";

/** The field set each use case is contracted to collect (schema + register). */
const EXPECTED_FIELDS: Record<string, string[]> = {
  minimal: ["email"],
  consumer: ["email", "givenName", "familyName"],
  business: ["email", "givenName", "familyName", "companyName"],
};

function registerFields(flow: ReturnType<typeof getDefaultLoginFlow>): string[] {
  const register = flow.steps.find((step) => step.name === "register");
  return (register?.fields ?? []) as string[];
}

/**
 * Use-case hygiene: every (use case × sign-in preset) pair must render a
 * schema/flow the server would accept, and the register step must collect
 * exactly the use case's fields — the composition contract from #448.
 */
describe.each([...SETUP_USE_CASES])("use case %s", (useCase) => {
  const expected = EXPECTED_FIELDS[useCase];

  it.each([...SETUP_PRESETS])("renders a valid schema+flow with preset %s", (preset) => {
    const schema = getDefaultHumanUserSchema({ preset, useCase });
    const flow = getDefaultLoginFlow({ preset, useCase, userSchemaUrl: "sch_TEST" });

    expect(schemaConfigSchema.safeParse(schema).success).toBe(true);
    expect(flowConfigSchema.safeParse(flow).success).toBe(true);
    expect(validateFlowDefinition(flow, schema as object)).toEqual([]);
  });

  it("collects exactly its field set, with email the only required property", () => {
    const schema = getDefaultHumanUserSchema({ useCase }) as unknown as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(expected);
    expect(schema.required).toEqual(["email"]);
  });

  it("derives the register step's fields from the use case, not a hard-coded list", () => {
    // Field set is owned by the use case, independent of the sign-in preset.
    expect(registerFields(getDefaultLoginFlow({ useCase, preset: "password-first" }))).toEqual(
      expected,
    );
    expect(registerFields(getDefaultLoginFlow({ useCase, preset: "passkey-first" }))).toEqual(
      expected,
    );
  });
});

describe("use-case selection", () => {
  it("defaults to minimal", () => {
    expect(DEFAULT_SETUP_USE_CASE).toBe("minimal");
    expect(getDefaultHumanUserSchema()).toEqual(getDefaultHumanUserSchema({ useCase: "minimal" }));
    expect(getDefaultLoginFlow()).toEqual(getDefaultLoginFlow({ useCase: "minimal" }));
  });

  it("gives business a companyName property stored as a plain attribute", () => {
    const schema = getDefaultHumanUserSchema({ useCase: "business" }) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(schema.properties.companyName).toMatchObject({ type: "string" });
    // companyName is not required and carries no identity wiring.
    // (The line above asserts presence, so the assertion here is safe.)
    expect(schema.properties.companyName!["x-unique"]).toBeUndefined();
  });

  it("keeps the field set identical across sign-in presets (schema owns fields, not the flow)", () => {
    for (const useCase of SETUP_USE_CASES) {
      const password = getDefaultHumanUserSchema({ useCase, preset: "password-first" }) as {
        properties: Record<string, unknown>;
      };
      const passkey = getDefaultHumanUserSchema({ useCase, preset: "passkey-first" }) as {
        properties: Record<string, unknown>;
      };
      expect(Object.keys(password.properties)).toEqual(Object.keys(passkey.properties));
    }
  });

  it("rejects an unknown use case naming the known ones", () => {
    expect(() => getDefaultHumanUserSchema({ useCase: "enterprise" })).toThrowError(
      /unknown setup use case "enterprise".*minimal.*consumer.*business/,
    );
  });

  it("rejects prototype-chain keys as unknown use cases", () => {
    for (const useCase of ["__proto__", "constructor", "toString"]) {
      expect(() => getDefaultHumanUserSchema({ useCase })).toThrowError(/unknown setup use case/);
      expect(() => getDefaultLoginFlow({ useCase })).toThrowError(/unknown setup use case/);
    }
  });
});
