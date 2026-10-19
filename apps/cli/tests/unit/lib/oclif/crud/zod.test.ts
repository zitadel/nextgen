import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defaultOf,
  fieldOf,
  isInteger,
  isOptionalField,
  nodeAt,
  objectOf,
  unwrap,
  type ZodLike,
} from "../../../../../src/lib/oclif/crud/zod";

const as = (schema: unknown): ZodLike => schema as ZodLike;

describe("isOptionalField", () => {
  it("takes a field with a default for optional, and a nullable one for required", () => {
    expect(isOptionalField(as(z.string().optional()))).toBe(true);
    expect(isOptionalField(as(z.boolean().default(true)))).toBe(true);
    expect(isOptionalField(as(z.string().nullable()))).toBe(false);
    expect(isOptionalField(as(z.string()))).toBe(false);
  });

  it("reads the wrappers of a schema that has no method for it", () => {
    expect(
      isOptionalField({ def: { type: "optional", innerType: { def: { type: "string" } } } }),
    ).toBe(true);
    expect(isOptionalField({ def: { type: "string" } })).toBe(false);
  });
});

describe("defaultOf", () => {
  it("returns what a default fills in, and nothing without one", () => {
    expect(defaultOf(as(z.array(z.string()).default(["openid"])))).toEqual({ value: ["openid"] });
    expect(defaultOf(as(z.string()))).toBeUndefined();
  });
});

describe("isInteger", () => {
  it("tells an integer from a number however it is written", () => {
    expect(isInteger(as(z.int()))).toBe(true);
    expect(isInteger(as(z.number().int().optional()))).toBe(true);
    expect(isInteger(as(z.number()))).toBe(false);
  });
});

describe("objectOf", () => {
  it("returns an object, or the object of one that may be null", () => {
    const object = z.object({ a: z.string() });
    expect(objectOf(as(object.optional()))).toBe(object);
    expect(objectOf(as(z.union([object, z.null()])))).toBe(object);
  });

  it("returns nothing for a union of several shapes or a record", () => {
    expect(objectOf(as(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])))).toBe(
      undefined,
    );
    expect(objectOf(as(z.record(z.string(), z.string())))).toBeUndefined();
  });
});

describe("fieldOf", () => {
  it("never answers with a property inherited from Object.prototype", () => {
    const schema = as(z.object({ a: z.string() }));
    expect(fieldOf(schema, "a")).toBeDefined();
    expect(fieldOf(schema, "toString")).toBeUndefined();
    expect(fieldOf(schema, "__proto__")).toBeUndefined();
  });
});

describe("nodeAt", () => {
  const schema = as(
    z.object({
      oidc: z.object({ issuer: z.string(), pkce: z.boolean() }).optional(),
      claims: z.record(z.string(), z.string()),
      attributes: z.record(z.string(), z.unknown()),
    }),
  );

  it("follows a path through nested objects to its schema", () => {
    expect(unwrap(nodeAt(schema, ["oidc", "pkce"])?.node)?.def?.type).toBe("boolean");
    expect(nodeAt(schema, ["oidc", "pkce"])?.open).toBe(false);
  });

  it("takes any key below an open record, with the record's value schema", () => {
    expect(unwrap(nodeAt(schema, ["claims", "email"])?.node)?.def?.type).toBe("string");
    expect(nodeAt(schema, ["attributes", "address", "city"])).toEqual({
      node: undefined,
      open: true,
    });
  });

  it("refuses a missing field and a path past a value with no fields", () => {
    expect(nodeAt(schema, ["oidc", "isuer"])).toBeUndefined();
    expect(nodeAt(schema, ["claims", "email", "x"])).toBeUndefined();
  });
});
