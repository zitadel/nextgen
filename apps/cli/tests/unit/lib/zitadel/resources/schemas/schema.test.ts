import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema } from "@zitadel/config/defaults";

import { RefusedEditError, UserSchema } from "@/lib/zitadel";
import { MemoryStore } from "@/lib/zitadel/storage";
import type { JsonObject } from "@/lib/zitadel/types";
import { objectAt } from "@/lib/zitadel/utils/json";
import { slug } from "@tests/helpers/idp-values";

/**
 * Where every schema in these tests sits.
 */
const PATH = ".zitadel/schemas/customers.json";

/**
 * A schema read from `.zitadel/schemas/`.
 *
 * @param body - What the file holds.
 * @returns The schema, as read.
 */
function schemaOf(body: JsonObject): UserSchema {
  return UserSchema.of({ path: PATH, body });
}

/**
 * The shipped minimal schema, as read.
 *
 * @returns The schema.
 */
function shippedSchema(): UserSchema {
  return schemaOf(getDefaultHumanUserSchema({ useCase: "minimal" }));
}

/**
 * A schema with password on, passkey off and SSO on for some providers.
 *
 * @param providers - The providers SSO lists.
 * @returns The schema, as read.
 */
function withProviders(providers: readonly string[]): UserSchema {
  return schemaOf({
    ...getDefaultHumanUserSchema(),
    "x-auth-methods": {
      password: { enabled: true },
      passkey: { enabled: false },
      sso: { enabled: true, providers },
    },
  });
}

/**
 * A schema's `x-auth-methods`.
 *
 * @param schema - The schema.
 * @returns Its methods; an empty object when it has none.
 */
function methodsOf(schema: UserSchema): JsonObject {
  return objectAt(schema.body, "x-auth-methods");
}

describe("UserSchema.of", () => {
  it("takes the file as read", () => {
    expect(shippedSchema().status).toBe("read");
  });
});

describe("UserSchema.create", () => {
  it("takes the file as new", () => {
    expect(UserSchema.create({ path: PATH, body: {} }).status).toBe("created");
  });
});

describe("UserSchema.asRead", () => {
  it("marks an edited schema as read", () => {
    const edited = shippedSchema().withProvider(slug("google")).document;

    expect(edited.asRead().status).toBe("read");
  });
});

describe("UserSchema.problems", () => {
  it("finds nothing wrong with the shipped schema", () => {
    expect(shippedSchema().problems({})).toEqual([]);
  });

  it("reports what the schema contract refuses, under contract/schema", () => {
    const issues = schemaOf({ objectType: 7 }).problems({});

    expect(
      issues.map((issue) => {
        return [issue.rule, issue.file, issue.severity];
      }),
    ).toContainEqual(["contract/schema", PATH, "error"]);
  });
});

describe("UserSchema.wireBody", () => {
  it("sends the schema without its $schema pointer", () => {
    const schema = schemaOf({ $schema: "../meta/user-schema.json", objectType: "customers" });

    expect(schema.wireBody(new MemoryStore())).toEqual({ objectType: "customers" });
  });
});

describe("UserSchema.providers", () => {
  it("returns malformed entries as written and leaves out what is not a string", () => {
    const schema = schemaOf({
      "x-auth-methods": { sso: { enabled: true, providers: ["google", "Not A Slug", 7] } },
    });

    expect(schema.providers).toEqual(["google", "Not A Slug"]);
  });
});

describe("UserSchema.signInProviders", () => {
  it("keeps only the providers that are well-formed slugs", () => {
    const schema = withProviders(["google", "Not A Slug"]);

    expect(schema.signInProviders).toEqual(["google"]);
  });
});

describe("UserSchema.assertProviderEditable", () => {
  it("accepts the shipped schema", () => {
    expect(() => {
      shippedSchema().assertProviderEditable();
    }).not.toThrow();
  });

  it("accepts a schema that has simply not got there yet", () => {
    expect(() => {
      schemaOf({}).assertProviderEditable();
    }).not.toThrow();
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
  ])("refuses a schema when %s", (region, body) => {
    expect(() => {
      schemaOf(body).assertProviderEditable();
    }).toThrow(`${PATH}: ${region}`);
  });
});

describe("UserSchema.withProvider", () => {
  it("enables the provider without touching password or passkey", () => {
    const schema = shippedSchema();

    const edited = schema.withProvider(slug("google")).document;

    expect(methodsOf(edited)).toEqual({
      ...methodsOf(schema),
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("marks the schema as edited", () => {
    expect(shippedSchema().withProvider(slug("google")).document.status).toBe("edited");
  });

  it("says it changed the schema", () => {
    expect(shippedSchema().withProvider(slug("google")).changed).toBe(true);
  });

  it("returns the same schema the second time", () => {
    const first = shippedSchema().withProvider(slug("google")).document;

    expect(first.withProvider(slug("google"))).toEqual({
      document: first,
      changed: false,
      skipped: [],
    });
  });

  it("keeps a provider that is already enabled when adding another", () => {
    const first = shippedSchema().withProvider(slug("google")).document;

    const second = first.withProvider(slug("github")).document;

    expect(objectAt(methodsOf(second), "sso").providers).toEqual(["google", "github"]);
  });

  it("keeps the schema's keys in their order", () => {
    const schema = shippedSchema();

    const edited = schema.withProvider(slug("google")).document;

    expect(Object.keys(edited.body)).toEqual(Object.keys(schema.body));
  });

  it("leaves the schema it was given as it was", () => {
    const schema = shippedSchema();
    const before = structuredClone(schema.body);

    schema.withProvider(slug("google"));

    expect(schema.body).toEqual(before);
  });

  it("shares nothing under sso with the schema it was given", () => {
    const options = { prompt: "login" };
    const schema = schemaOf({
      "x-auth-methods": { sso: { enabled: false, providers: [], options } },
    });

    const edited = schema.withProvider(slug("google")).document;

    expect(objectAt(methodsOf(edited), "sso").options).not.toBe(options);
  });

  it("refuses a schema whose sso region was edited by hand", () => {
    const schema = schemaOf({ "x-auth-methods": { sso: true } });

    expect(() => {
      return schema.withProvider(slug("google"));
    }).toThrow(RefusedEditError);
  });
});

describe("UserSchema.withoutProvider", () => {
  it("takes one provider out and keeps the rest", () => {
    const edited = withProviders(["google", "github"]).withoutProvider("google").document;

    expect(methodsOf(edited).sso).toEqual({ enabled: true, providers: ["github"] });
  });

  it("turns SSO off when the last provider goes", () => {
    const edited = withProviders(["google"]).withoutProvider("google").document;

    expect(methodsOf(edited).sso).toEqual({ enabled: false });
  });

  it("leaves password and passkey as they are", () => {
    const edited = withProviders(["google"]).withoutProvider("google").document;

    expect([methodsOf(edited).password, methodsOf(edited).passkey]).toEqual([
      { enabled: true },
      { enabled: false },
    ]);
  });

  it("does not change the schema it was given", () => {
    const schema = withProviders(["google"]);
    const before = structuredClone(schema.body);

    schema.withoutProvider("google");

    expect(schema.body).toEqual(before);
  });

  it("returns the same schema for a provider it does not offer", () => {
    const schema = withProviders(["github"]);

    expect(schema.withoutProvider("google")).toEqual({
      document: schema,
      changed: false,
      skipped: [],
    });
  });

  it("refuses a schema whose provider list was edited by hand", () => {
    const schema = schemaOf({ "x-auth-methods": { sso: { enabled: true, providers: "google" } } });

    expect(() => {
      return schema.withoutProvider("google");
    }).toThrow(RefusedEditError);
  });
});

describe("UserSchema.withMethod", () => {
  it("switches a method on and keeps what else its entry holds", () => {
    const schema = schemaOf({ "x-auth-methods": { passkey: { enabled: false, label: "Key" } } });

    const edited = schema.withMethod("passkey").document;

    expect(methodsOf(edited).passkey).toEqual({ enabled: true, label: "Key" });
  });

  it("returns the same schema when the method is already on", () => {
    const schema = withProviders([]);

    expect(schema.withMethod("password")).toEqual({
      document: schema,
      changed: false,
      skipped: [],
    });
  });

  it("refuses password on a schema with no identifier", () => {
    const schema = schemaOf({ "x-auth-methods": { password: { enabled: false } } });

    expect(() => {
      return schema.withMethod("password");
    }).toThrow(`${PATH} has no x-identifier for password`);
  });

  it("refuses a method whose entry was edited by hand", () => {
    const schema = schemaOf({ "x-auth-methods": { passkey: { enabled: "yes" } } });

    expect(() => {
      return schema.withMethod("passkey");
    }).toThrow(`${PATH}: x-auth-methods.passkey.enabled is not a boolean`);
  });
});

describe("UserSchema.withoutMethod", () => {
  it("switches a method off and keeps what else its entry holds", () => {
    const schema = schemaOf({ "x-auth-methods": { passkey: { enabled: true, label: "Key" } } });

    const edited = schema.withoutMethod("passkey").document;

    expect(methodsOf(edited).passkey).toEqual({ enabled: false, label: "Key" });
  });

  it("returns the same schema when the method is already off", () => {
    const schema = withProviders([]);

    expect(schema.withoutMethod("passkey")).toEqual({
      document: schema,
      changed: false,
      skipped: [],
    });
  });

  it("refuses a method whose container was edited by hand", () => {
    const schema = schemaOf({ "x-auth-methods": [] });

    expect(() => {
      return schema.withoutMethod("passkey");
    }).toThrow(`${PATH}: x-auth-methods is not an object`);
  });
});
