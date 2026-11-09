import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema } from "@zitadel/config/defaults";

import { RefusedEditError, UserSchema } from "@/lib/zitadel";
import { MemoryStore } from "@/lib/zitadel/storage";
import { objectAt } from "@/lib/zitadel/utils/json";
import { aFile, aUserSchema } from "@tests/helpers/config";
import { slug } from "@tests/helpers/idp-values";
import { aSchemaListing } from "@tests/helpers/schemas";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * The file name of every schema in these tests.
 */
const SCHEMA_FILE = "customers.json";

/**
 * Where every schema in these tests sits.
 */
const PATH = `.zitadel/schemas/${SCHEMA_FILE}`;

/**
 * The shipped minimal schema.
 */
const SHIPPED = getDefaultHumanUserSchema({ useCase: "minimal" });

/**
 * A schema with password on, passkey off and SSO on through Google.
 */
const PASSWORD_AND_GOOGLE = aUserSchema({
  "x-auth-methods": {
    password: { enabled: true },
    passkey: { enabled: false },
    sso: { enabled: true, providers: ["google"] },
  },
});

/**
 * A schema with password on and passkey off.
 */
const PASSWORD_ONLY = aUserSchema({
  "x-auth-methods": { password: { enabled: true }, passkey: { enabled: false } },
});

describe("UserSchema.of", () => {
  it("takes the file as read", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    expect(schema.status).toBe("read");
  });
});

describe("UserSchema.create", () => {
  it("takes the file as new", () => {
    const schema = UserSchema.create(aFile("schemas", SCHEMA_FILE, {}));

    expect(schema.status).toBe("created");
  });
});

describe("UserSchema.handle", () => {
  it("is the objectType a release pins the schema by", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, { objectType: "human-user" }));

    const handle = schema.handle;

    expect(handle).toBe("human-user");
  });

  it("is undefined for a schema with no objectType", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, { objectType: "" }));

    const handle = schema.handle;

    expect(handle).toBeUndefined();
  });
});

describe("UserSchema.asRead", () => {
  it("marks an edited schema as read", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));
    const edited = schema.withProvider(slug("google")).document;

    const read = edited.asRead();

    expect(read.status).toBe("read");
  });
});

describe("UserSchema.problems", () => {
  it("finds nothing wrong with the shipped schema", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    const issues = schema.problems({});

    expect(issues).toEqual([]);
  });

  it("reports what the schema contract refuses, under contract/schema", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, { objectType: 7 }));

    const issues = schema.problems({});

    expect(issues).toContainEqual(
      expect.objectContaining({ rule: "contract/schema", file: PATH, severity: "error" }),
    );
  });
});

describe("UserSchema.wireBody", () => {
  it("sends the schema without its $schema pointer", () => {
    const body = { $schema: "../meta/user-schema.json", objectType: "customers" };
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, body));

    const wire = schema.wireBody(new MemoryStore());

    expect(wire).toEqual({ objectType: "customers" });
  });
});

describe("UserSchema.identifier", () => {
  it("is the property x-identifier designates, as written", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, { "x-identifier": "profile.email" }),
    );

    const identifier = schema.identifier;

    expect(identifier).toBe("profile.email");
  });

  it.each([
    ["missing", {}],
    ["not a string", { "x-identifier": 7 }],
    ["blank", { "x-identifier": "  " }],
  ])("is undefined when x-identifier is %s", (_case, body) => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, body));

    const identifier = schema.identifier;

    expect(identifier).toBeUndefined();
  });
});

describe("UserSchema.providers", () => {
  it("returns malformed entries as written and leaves out what is not a string", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, {
        "x-auth-methods": { sso: { enabled: true, providers: ["google", "Not A Slug", 7] } },
      }),
    );

    const providers = schema.providers;

    expect(providers).toEqual(["google", "Not A Slug"]);
  });
});

describe("UserSchema.signInProviders", () => {
  it("keeps only the providers that are well-formed slugs", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, aSchemaListing(["google", "Not A Slug"])),
    );

    const providers = schema.signInProviders;

    expect(providers).toEqual(["google"]);
  });
});

describe("UserSchema.assertProviderEditable", () => {
  it.each([
    ["the shipped schema", SHIPPED],
    ["a schema that has simply not got there yet", {}],
  ])("accepts %s", (_case, body) => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, body));

    const error = thrownBy(() => {
      schema.assertProviderEditable();
    });

    expect(error).toBeUndefined();
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
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, body));

    const error = thrownBy(() => {
      schema.assertProviderEditable();
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({ message: `${PATH}: ${region}` });
  });
});

describe("UserSchema.withProvider", () => {
  it("enables the provider without touching password or passkey", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    const edited = schema.withProvider(slug("google")).document;

    expect(edited.body["x-auth-methods"]).toEqual({
      ...objectAt(schema.body, "x-auth-methods"),
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("marks the schema as edited", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    const edited = schema.withProvider(slug("google")).document;

    expect(edited.status).toBe("edited");
  });

  it("says it changed the schema", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    const edit = schema.withProvider(slug("google"));

    expect(edit.changed).toBe(true);
  });

  it("returns the same schema the second time", () => {
    const first = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED)).withProvider(
      slug("google"),
    ).document;

    const second = first.withProvider(slug("google"));

    expect(second).toEqual({ document: first, changed: false, skipped: [] });
  });

  it("keeps a provider that is already enabled when adding another", () => {
    const first = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED)).withProvider(
      slug("google"),
    ).document;

    const second = first.withProvider(slug("github")).document;

    expect(objectAt(objectAt(second.body, "x-auth-methods"), "sso").providers).toEqual([
      "google",
      "github",
    ]);
  });

  it("keeps the schema's keys in their order", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    const edited = schema.withProvider(slug("google")).document;

    expect(Object.keys(edited.body)).toEqual(Object.keys(schema.body));
  });

  it("leaves the schema it was given as it was", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));
    const before = structuredClone(schema.body);

    schema.withProvider(slug("google"));

    expect(schema.body).toEqual(before);
  });

  it("shares nothing under sso with the schema it was given", () => {
    const options = { prompt: "login" };
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, {
        "x-auth-methods": { sso: { enabled: false, providers: [], options } },
      }),
    );

    const edited = schema.withProvider(slug("google")).document;

    expect(objectAt(objectAt(edited.body, "x-auth-methods"), "sso").options).not.toBe(options);
  });

  it("refuses a schema whose sso region was edited by hand", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, { "x-auth-methods": { sso: true } }),
    );

    const error = thrownBy(() => {
      return schema.withProvider(slug("google"));
    });

    expect(error).toBeInstanceOf(RefusedEditError);
  });
});

describe("UserSchema.withoutProvider", () => {
  it("takes one provider out and keeps the rest", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, aSchemaListing(["google", "github"])),
    );

    const edited = schema.withoutProvider("google").document;

    expect(objectAt(edited.body, "x-auth-methods").sso).toEqual({
      enabled: true,
      providers: ["github"],
    });
  });

  it("turns SSO off when the last provider goes", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, aSchemaListing(["google"])));

    const edited = schema.withoutProvider("google").document;

    expect(objectAt(edited.body, "x-auth-methods").sso).toEqual({ enabled: false });
  });

  it("leaves password and passkey as they are", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, PASSWORD_AND_GOOGLE));

    const edited = schema.withoutProvider("google").document;

    expect(objectAt(edited.body, "x-auth-methods")).toMatchObject({
      password: { enabled: true },
      passkey: { enabled: false },
    });
  });

  it("does not change the schema it was given", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, aSchemaListing(["google"])));
    const before = structuredClone(schema.body);

    schema.withoutProvider("google");

    expect(schema.body).toEqual(before);
  });

  it("returns the same schema for a provider it does not offer", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, aSchemaListing(["github"])));

    const edit = schema.withoutProvider("google");

    expect(edit).toEqual({ document: schema, changed: false, skipped: [] });
  });

  it("refuses a schema whose provider list was edited by hand", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, {
        "x-auth-methods": { sso: { enabled: true, providers: "google" } },
      }),
    );

    const error = thrownBy(() => {
      return schema.withoutProvider("google");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
  });
});

describe("UserSchema.withMethod", () => {
  it("switches a method on and keeps what else its entry holds", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, {
        "x-auth-methods": { passkey: { enabled: false, label: "Key" } },
      }),
    );

    const edited = schema.withMethod("passkey").document;

    expect(objectAt(edited.body, "x-auth-methods").passkey).toEqual({
      enabled: true,
      label: "Key",
    });
  });

  it("returns the same schema when the method is already on", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, PASSWORD_ONLY));

    const edit = schema.withMethod("password");

    expect(edit).toEqual({ document: schema, changed: false, skipped: [] });
  });

  it("refuses password on a schema with no identifier", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, { "x-auth-methods": { password: { enabled: false } } }),
    );

    const error = thrownBy(() => {
      return schema.withMethod("password");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({ message: `${PATH} has no x-identifier for password` });
  });

  it("refuses a method whose entry was edited by hand", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, { "x-auth-methods": { passkey: { enabled: "yes" } } }),
    );

    const error = thrownBy(() => {
      return schema.withMethod("passkey");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: `${PATH}: x-auth-methods.passkey.enabled is not a boolean`,
    });
  });
});

describe("UserSchema.withoutMethod", () => {
  it("switches a method off and keeps what else its entry holds", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, {
        "x-auth-methods": { passkey: { enabled: true, label: "Key" } },
      }),
    );

    const edited = schema.withoutMethod("passkey").document;

    expect(objectAt(edited.body, "x-auth-methods").passkey).toEqual({
      enabled: false,
      label: "Key",
    });
  });

  it("returns the same schema when the method is already off", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, PASSWORD_ONLY));

    const edit = schema.withoutMethod("passkey");

    expect(edit).toEqual({ document: schema, changed: false, skipped: [] });
  });

  it("refuses a method whose container was edited by hand", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, { "x-auth-methods": [] }));

    const error = thrownBy(() => {
      return schema.withoutMethod("passkey");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({ message: `${PATH}: x-auth-methods is not an object` });
  });
});
