import { describe, expect, it } from "vitest";

import { getDefaultHumanUserSchema } from "@zitadel/config/defaults";

import { BrokenFilesError, RefusedEditError, UserSchema } from "@/lib/zitadel";
import { propertyName } from "@/lib/zitadel/names";
import { BrokenFile } from "@/lib/zitadel/resources/broken";
import { MemoryStore } from "@tests/helpers/storage/backend/memory";
import { objectAt, toJsonObject } from "@/lib/zitadel/utils/json";
import { aFile, aUserSchema } from "@tests/helpers/config";
import { slug } from "@tests/helpers/idp-values";
import { aSchemaListing, aUserSchemaWithout } from "@tests/helpers/schemas";
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
const SHIPPED = toJsonObject(
  getDefaultHumanUserSchema({ useCase: "minimal" }),
  "the shipped schema",
);

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
 * A schema whose `objectType` the schema contract refuses.
 */
const REFUSED = aUserSchema({ objectType: 7 });

/**
 * A schema with password on and passkey off.
 */
const PASSWORD_ONLY = aUserSchema({
  "x-auth-methods": { password: { enabled: true }, passkey: { enabled: false } },
});

describe("UserSchema.read", () => {
  it("takes a body the schema contract accepts as a schema", () => {
    const reading = UserSchema.read(aFile("schemas", SCHEMA_FILE, SHIPPED));

    expect(reading).toBeInstanceOf(UserSchema);
  });

  it.each([
    ["an objectType that is not a string", REFUSED],
    ["no x-auth-methods", aUserSchemaWithout("x-auth-methods")],
    ["x-auth-methods that is not an object", aUserSchema({ "x-auth-methods": [] })],
    ["a method entry that is not an object", aUserSchema({ "x-auth-methods": { sso: true } })],
    [
      "a method whose enabled is not a boolean",
      aUserSchema({ "x-auth-methods": { passkey: { enabled: "yes" } } }),
    ],
    [
      "a method entry holding a key it does not have",
      aUserSchema({ "x-auth-methods": { passkey: { enabled: false, label: "Key" } } }),
    ],
    ["a provider that is not a slug", aSchemaListing(["google", "Not A Slug"])],
  ])("files a schema with %s as broken", (_case, body) => {
    const reading = UserSchema.read(aFile("schemas", SCHEMA_FILE, body));

    expect(reading).toBeInstanceOf(BrokenFile);
  });

  it("reports what the schema contract refuses, under contract/schema", () => {
    const reading = UserSchema.read(aFile("schemas", SCHEMA_FILE, REFUSED));

    expect(reading).toMatchObject({
      issues: [expect.objectContaining({ rule: "contract/schema", file: PATH, severity: "error" })],
    });
  });

  describe("with keys the user meta-schema does not declare", () => {
    const body = aUserSchema({
      "x-team-note": "kept",
      properties: {
        firstName: { type: "string", minimumLength: 3 },
        address: { type: "object", properties: { zip: { type: "string", maxLenght: 5 } } },
      },
    });

    it("files the schema as broken", () => {
      const reading = UserSchema.read(aFile("schemas", SCHEMA_FILE, body));

      expect(reading).toBeInstanceOf(BrokenFile);
    });

    it("names every refused key at its path, with the keyword it is closest to", () => {
      const reading = UserSchema.read(aFile("schemas", SCHEMA_FILE, body));

      expect(reading).toMatchObject({
        issues: expect.arrayContaining([
          expect.objectContaining({
            rule: "contract/schema",
            message: "(root) x-team-note is not an allowed key",
          }),
          expect.objectContaining({
            rule: "contract/schema",
            message:
              "properties.firstName minimumLength is not an allowed key. Did you mean minLength?",
          }),
          expect.objectContaining({
            rule: "contract/schema",
            message:
              "properties.address.properties.zip maxLenght is not an allowed key. Did you mean maxLength?",
          }),
        ]),
      });
    });
  });

  it("takes an attribute named like a keyword", () => {
    const body = aUserSchema({ properties: { minimumLength: { type: "integer", minimum: 0 } } });

    const reading = UserSchema.read(aFile("schemas", SCHEMA_FILE, body));

    expect(reading).toBeInstanceOf(UserSchema);
  });

  it("takes a schema-url reference, which has no user meta-schema to meet", () => {
    const body = { kind: "schema-url", url: "https://schemas.example.com/user.json" };

    const reading = UserSchema.read(aFile("schemas", SCHEMA_FILE, body));

    expect(reading).toBeInstanceOf(UserSchema);
  });
});

describe("UserSchema.refusesKey", () => {
  it.each([
    [true, "contract/schema", "properties.firstName minimumLength is not an allowed key"],
    [false, "contract/schema", "objectType Expected string"],
    [false, "contract/flow", "steps.0 foo is not an allowed key"],
  ])("is %s for a %s finding saying %j", (expected, rule, message) => {
    expect(UserSchema.refusesKey({ rule, message })).toBe(expected);
  });
});

describe("UserSchema.of", () => {
  it("takes the file as read", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    expect(schema.status).toBe("read");
  });

  it("refuses a body the schema contract refuses, naming the file", () => {
    const error = thrownBy(() => {
      return UserSchema.of(aFile("schemas", SCHEMA_FILE, REFUSED));
    });

    expect(error).toBeInstanceOf(BrokenFilesError);
    expect(error).toMatchObject({ problems: [expect.objectContaining({ path: PATH })] });
  });
});

describe("UserSchema.create", () => {
  it("takes the file as new", () => {
    const schema = UserSchema.create(aFile("schemas", SCHEMA_FILE, aUserSchema()));

    expect(schema.status).toBe("created");
  });
});

describe("UserSchema.handle", () => {
  it("is the objectType a release pins the schema by", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, aUserSchema()));

    const handle = schema.handle;

    expect(handle).toBe("human-user");
  });

  it("is undefined for a schema with no objectType", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, aUserSchema({ objectType: "" })));

    const handle = schema.handle;

    expect(handle).toBeUndefined();
  });
});

describe("UserSchema.check", () => {
  it("finds nothing wrong with the shipped schema", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, SHIPPED));

    const issues = schema.check({});

    expect(issues).toEqual([]);
  });
});

describe("UserSchema.toWireBody", () => {
  it("sends the schema without its $schema pointer", () => {
    const body = { $schema: "../meta/user-schema.json", ...aUserSchema() };
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, body));

    const wire = schema.toWireBody(new MemoryStore());

    expect(wire).toEqual(aUserSchema());
  });
});

describe("UserSchema.identifier", () => {
  it("is the property x-identifier designates, as written", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, aUserSchema({ "x-identifier": "profile.email" })),
    );

    const identifier = schema.identifier;

    expect(identifier).toBe("profile.email");
  });

  it.each([
    ["missing", aUserSchemaWithout("x-identifier")],
    ["blank", aUserSchema({ "x-identifier": "  " })],
  ])("is undefined when x-identifier is %s", (_case, body) => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, body));

    const identifier = schema.identifier;

    expect(identifier).toBeUndefined();
  });
});

describe("UserSchema.requiredByServer", () => {
  it("leaves out the identifier a password asks for", () => {
    const schema = UserSchema.of(
      aFile(
        "schemas",
        SCHEMA_FILE,
        aUserSchema({
          required: ["name"],
          properties: { email: { type: "string" }, name: { type: "string" } },
        }),
      ),
    );

    expect({ server: schema.requiredByServer, all: schema.requiredPaths }).toEqual({
      server: ["name"],
      all: ["name", "email"],
    });
  });

  it("includes what an allOf requires", () => {
    const schema = UserSchema.of(
      aFile(
        "schemas",
        SCHEMA_FILE,
        aUserSchema({
          properties: { email: { type: "string" }, name: { type: "string" } },
          allOf: [{ required: ["name"] }],
        }),
      ),
    );

    expect(schema.requiredByServer).toEqual(["name"]);
  });
});

describe("UserSchema.providers", () => {
  it("lists every provider x-auth-methods.sso names, in order", () => {
    const schema = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, aSchemaListing(["google", "github"])),
    );

    const providers = schema.providers;

    expect(providers).toEqual(["google", "github"]);
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
});

describe("UserSchema.withMethod", () => {
  it("switches a method on", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, PASSWORD_ONLY));

    const edited = schema.withMethod("passkey").document;

    expect(objectAt(edited.body, "x-auth-methods").passkey).toEqual({ enabled: true });
  });

  it("returns the same schema when the method is already on", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, PASSWORD_ONLY));

    const edit = schema.withMethod("password");

    expect(edit).toEqual({ document: schema, changed: false, skipped: [] });
  });

  it("refuses password on a schema with no identifier", () => {
    const schema = UserSchema.of(
      aFile(
        "schemas",
        SCHEMA_FILE,
        aUserSchemaWithout("x-identifier", { "x-auth-methods": { password: { enabled: false } } }),
      ),
    );

    const error = thrownBy(() => {
      return schema.withMethod("password");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({ message: `${PATH} has no x-identifier for password` });
  });
});

describe("UserSchema.withoutMethod", () => {
  it("switches a method off", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, PASSWORD_ONLY));

    const edited = schema.withoutMethod("password").document;

    expect(objectAt(edited.body, "x-auth-methods").password).toEqual({ enabled: false });
  });

  it("returns the same schema when the method is already off", () => {
    const schema = UserSchema.of(aFile("schemas", SCHEMA_FILE, PASSWORD_ONLY));

    const edit = schema.withoutMethod("passkey");

    expect(edit).toEqual({ document: schema, changed: false, skipped: [] });
  });
});

describe("UserSchema.isSignInMethod", () => {
  it.each([
    ["password", true],
    ["passkey", true],
    ["sso", true],
    ["otp", false],
    ["", false],
  ])("answers %j with %s", (method, expected) => {
    expect(UserSchema.isSignInMethod(method)).toBe(expected);
  });
});

describe("UserSchema edits of an external schema", () => {
  const external = UserSchema.of(
    aFile("schemas", SCHEMA_FILE, {
      kind: "schema-url",
      url: "https://schemas.test.invalid/remote.json",
    }),
  );

  it.each([
    {
      method: "withMethod",
      edit: (schema: UserSchema) => {
        return schema.withMethod("passkey");
      },
    },
    {
      method: "withoutMethod",
      edit: (schema: UserSchema) => {
        return schema.withoutMethod("passkey");
      },
    },
    {
      method: "withProvider",
      edit: (schema: UserSchema) => {
        return schema.withProvider(slug("google"));
      },
    },
    {
      method: "withoutProvider",
      edit: (schema: UserSchema) => {
        return schema.withoutProvider("google");
      },
    },
  ])("$method refuses it", ({ edit }) => {
    const error = thrownBy(() => {
      return edit(external);
    });

    expect(error).toBeInstanceOf(RefusedEditError);
  });
});

describe("UserSchema.isUnique", () => {
  const schema = UserSchema.of(
    aFile(
      "schemas",
      SCHEMA_FILE,
      aUserSchema({
        properties: { email: { "x-unique": "project" }, givenName: { type: "string" } },
      }),
    ),
  );

  it.each([
    ["a property declared x-unique", "email", true],
    ["a property that is not", "givenName", false],
    ["a property the schema does not define", "shoeSize", false],
  ])("answers for %s", (_what, name, expected) => {
    expect(schema.isUnique(propertyName(name))).toBe(expected);
  });
});

describe("UserSchema.withProperties", () => {
  const schema = () => {
    return UserSchema.of(
      aFile("schemas", SCHEMA_FILE, aUserSchema({ properties: { email: { type: "string" } } })),
    );
  };

  it("adds a property typed to hold what fills it", () => {
    const edit = schema().withProperties([{ name: "employeeNumber", type: "integer" }]);

    expect({
      changed: edit.changed,
      property: objectAt(edit.document.body, "properties").employeeNumber,
    }).toEqual({
      changed: true,
      property: { type: "integer", description: "Filled from an identity provider claim." },
    });
  });

  it("keeps a property the schema defines already as it is", () => {
    const original = schema();

    const edit = original.withProperties([{ name: "email", type: "integer" }]);

    expect({ changed: edit.changed, same: edit.document === original }).toEqual({
      changed: false,
      same: true,
    });
  });

  it("adds a property named like one every object has", () => {
    const edit = schema().withProperties([{ name: "constructor", type: "string" }]);

    expect(Object.hasOwn(objectAt(edit.document.body, "properties"), "constructor")).toBe(true);
  });

  it("changes nothing when there is nothing to add", () => {
    expect(schema().withProperties([]).changed).toBe(false);
  });

  it("refuses a schema that points at an external schema", () => {
    const external = UserSchema.of(
      aFile("schemas", SCHEMA_FILE, {
        kind: "schema-url",
        url: "https://schemas.test.invalid/remote.json",
      }),
    );

    const error = thrownBy(() => {
      return external.withProperties([{ name: "employeeNumber", type: "string" }]);
    });

    expect(error).toBeInstanceOf(RefusedEditError);
  });
});
