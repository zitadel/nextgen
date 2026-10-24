import { isObject } from "../json";

import type { SchemaAttribute } from "./claims";

/** The steps of a login flow that ask a person for their details. */
const COLLECTING_STEPS = new Set(["register", "register-sso"]);

/**
 * The user schema with the properties a claim mapping added. Each is typed to
 * hold the claim it is filled from and optional, so a user the provider sends
 * nothing for can still be created.
 */
export function addAttributesToSchema(
  schema: Record<string, unknown>,
  created: readonly SchemaAttribute[],
): Record<string, unknown> {
  if (created.length === 0) {
    return schema;
  }
  const properties = isObject(schema.properties) ? schema.properties : {};
  return {
    ...schema,
    properties: {
      ...properties,
      ...Object.fromEntries(
        created.map((attribute) => [
          attribute.name,
          { type: attribute.type, description: `Filled from an identity provider claim.` },
        ]),
      ),
    },
  };
}

/**
 * The login flow with the new attributes added to the steps that collect a
 * person's details, so one the provider does not send is asked for instead of
 * left empty. A step that lists its fields already is not given them twice.
 */
export function addAttributesToFlow(
  flow: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  if (names.length === 0 || !Array.isArray(flow.steps)) {
    return flow;
  }
  return {
    ...flow,
    steps: flow.steps.map((step: unknown) => {
      if (
        !isObject(step) ||
        typeof step.name !== "string" ||
        !COLLECTING_STEPS.has(step.name) ||
        !Array.isArray(step.fields)
      ) {
        return step;
      }
      const fields = step.fields as unknown[];
      return { ...step, fields: [...fields, ...names.filter((name) => !fields.includes(name))] };
    }),
  };
}
