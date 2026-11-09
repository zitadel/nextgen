import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema } from "@zitadel/config/defaults";

import { addSsoToSchema, removeSsoFromSchema, schemaEditRefusal } from "@/lib/zitadel/schemas/sso";
import { objectAt } from "@/lib/zitadel/utils/json";
import { slug } from "@tests/helpers/idp-values";

/** A schema's `x-auth-methods`, for reading in the tests below. */
function methodsOf(schema: object): Record<string, unknown> {
  return objectAt(schema as Record<string, unknown>, "x-auth-methods");
}

/** The shipped minimal schema. */
function shippedSchema(): Record<string, unknown> {
  return getDefaultHumanUserSchema({ useCase: "minimal" }) as unknown as Record<string, unknown>;
}

describe("schemaEditRefusal", () => {
  it("accepts the shipped schema", () => {
    expect(schemaEditRefusal(getDefaultHumanUserSchema())).toBeUndefined();
  });

  it("accepts a schema that has simply not got there yet", () => {
    // An absent region is written, which is the whole point of the editors.
    expect(schemaEditRefusal({})).toBeUndefined();
  });

  it.each([
    ["x-auth-methods is not an object", { "x-auth-methods": "password" }],
    ["x-auth-methods.sso is not an object", { "x-auth-methods": { sso: true } }],
    [
      "x-auth-methods.sso.providers is not a list",
      { "x-auth-methods": { sso: { enabled: true, providers: "google" } } },
    ],
    [
      "x-auth-methods.sso.enabled is not a boolean",
      { "x-auth-methods": { sso: { providers: ["google"] } } },
    ],
    [
      "x-auth-methods.sso.enabled is not a boolean",
      { "x-auth-methods": { sso: { enabled: "true", providers: ["google"] } } },
    ],
  ])("refuses a schema when %s", (region, schema) => {
    expect(schemaEditRefusal(schema)).toBe(region);
  });
});

describe("addSsoToSchema", () => {
  it("enables the provider without touching password or passkey", () => {
    const schema = shippedSchema();
    const before = structuredClone(methodsOf(schema));

    const { body, changed } = addSsoToSchema(schema, slug("google"));

    expect(changed).toBe(true);
    expect(methodsOf(body).sso).toEqual({ enabled: true, providers: ["google"] });
    expect(methodsOf(body).password).toEqual(before.password);
    expect(methodsOf(body).passkey).toEqual(before.passkey);
  });

  it("is a no-op the second time", () => {
    const first = addSsoToSchema(shippedSchema(), slug("google"));

    const second = addSsoToSchema(first.body, slug("google"));

    expect(second.changed).toBe(false);
    expect(second.body).toEqual(first.body);
  });

  it("keeps a provider that is already enabled when adding another", () => {
    const first = addSsoToSchema(shippedSchema(), slug("google"));

    const second = addSsoToSchema(first.body, slug("github"));

    expect(objectAt(methodsOf(second.body), "sso").providers).toEqual(["google", "github"]);
  });

  it("keeps the schema's keys in their order", () => {
    const schema = shippedSchema();

    const { body } = addSsoToSchema(schema, slug("google"));

    expect(Object.keys(body)).toEqual(Object.keys(schema));
  });

  it("leaves the schema it was given as it was", () => {
    const schema = shippedSchema();
    const before = structuredClone(schema);

    addSsoToSchema(schema, slug("google"));

    expect(schema).toEqual(before);
  });

  it("shares nothing under sso with the schema it was given", () => {
    const options = { prompt: "login" };
    const schema = { "x-auth-methods": { sso: { enabled: false, providers: [], options } } };

    const { body } = addSsoToSchema(schema, slug("google"));

    expect(objectAt(methodsOf(body), "sso").options).not.toBe(options);
  });
});

describe("removeSsoFromSchema", () => {
  const withProviders = (providers: string[]): Record<string, unknown> => {
    return {
      ...getDefaultHumanUserSchema(),
      "x-auth-methods": {
        password: { enabled: true },
        passkey: { enabled: false },
        sso: { enabled: true, providers },
      },
    };
  };

  it("takes one provider out and keeps the rest", () => {
    const { body, changed } = removeSsoFromSchema(withProviders(["google", "github"]), "google");

    expect(changed).toBe(true);
    expect(methodsOf(body).sso).toEqual({ enabled: true, providers: ["github"] });
  });

  it("turns SSO off when the last provider goes", () => {
    const { body } = removeSsoFromSchema(withProviders(["google"]), "google");

    expect(methodsOf(body).sso).toEqual({ enabled: false });
  });

  it("leaves password and passkey as they are", () => {
    const { body } = removeSsoFromSchema(withProviders(["google"]), "google");

    expect(methodsOf(body).password).toEqual({ enabled: true });
    expect(methodsOf(body).passkey).toEqual({ enabled: false });
  });

  it("does not change the schema it was given", () => {
    const schema = withProviders(["google"]);
    const copy = structuredClone(schema);

    removeSsoFromSchema(schema, "google");

    expect(schema).toEqual(copy);
  });

  it("changes nothing for a provider the schema does not offer", () => {
    const schema = withProviders(["github"]);

    expect(removeSsoFromSchema(schema, "google")).toEqual({
      body: schema,
      changed: false,
      skipped: [],
    });
  });
});
