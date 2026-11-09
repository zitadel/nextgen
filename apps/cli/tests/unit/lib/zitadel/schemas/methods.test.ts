import { describe, expect, it } from "vitest";

import {
  BrokenFlowsError,
  NoSignInLeftError,
  RefusedEditError,
  type UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import { disableMethod, enableMethod } from "@/lib/zitadel/schemas/methods";
import type { JsonObject } from "@/lib/zitadel/types";
import { thrownBy } from "@tests/helpers/thrown-value";

const SCHEMA_PATH = ".zitadel/schemas/customers.json";
const SCHEMA_ID = "https://schemas.test.invalid/customers.json";

/** A user schema with these auth methods, with no identifier when it is `null`. */
function schemaBody(methods: unknown, identifier: string | null = "email"): JsonObject {
  const body = {
    $id: SCHEMA_ID,
    type: "object",
    required: ["email"],
    properties: { email: { type: "string", format: "email" } },
    "x-auth-methods": methods,
  };
  if (identifier === null) {
    return body;
  }
  return { ...body, "x-identifier": identifier };
}

/** The configuration with one schema and these flows. */
function configOf(schema: JsonObject, flows: readonly JsonObject[] = []): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [{ path: SCHEMA_PATH, body: schema }],
    flows: flows.map((body, index) => {
      return { path: `.zitadel/flows/flow-${index}.json`, body };
    }),
    connections: [],
    policies: [],
    branding: [],
  });
}

/** The configuration's only schema. */
function schemaIn(config: ZitadelConfig): UserSchema {
  const schema = config.schema(SCHEMA_PATH);
  if (schema === undefined) {
    throw new Error("the configuration has no schema");
  }
  return schema;
}

/** The `x-auth-methods` a configuration's schema holds. */
function methodsIn(config: ZitadelConfig): unknown {
  return schemaIn(config).body["x-auth-methods"];
}

/** A flow whose login journey collects a password. */
const passwordFlow = {
  name: "login",
  status: "active",
  user_schema: SCHEMA_ID,
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

describe("enableMethod", () => {
  it("switches only the named method", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: false } }),
    );

    const change = enableMethod(config, schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      password: { enabled: true },
      passkey: { enabled: true },
    });
  });

  it("keeps the other methods as they are", () => {
    const config = configOf(
      schemaBody({ passkey: { enabled: false }, sso: { enabled: true, providers: ["google"] } }),
    );

    const change = enableMethod(config, schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      passkey: { enabled: true },
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("keeps what else the method's entry holds", () => {
    const config = configOf(
      schemaBody({ passkey: { enabled: false, user_verification: "required" } }),
    );

    const change = enableMethod(config, schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      passkey: { enabled: true, user_verification: "required" },
    });
  });

  it("adds a method the schema does not mention", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const change = enableMethod(config, schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toMatchObject({ passkey: { enabled: true } });
  });

  it("writes the schema", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    expect(enableMethod(config, schemaIn(config), "passkey").changedPaths).toEqual([SCHEMA_PATH]);
  });

  it("writes nothing for a method already on", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [passwordFlow]);

    const change = enableMethod(config, schemaIn(config), "password");

    expect(change.changed).toBe(false);
  });

  it("does not change the configuration it was given", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));
    const copy = structuredClone(schemaIn(config).body);

    enableMethod(config, schemaIn(config), "passkey");

    expect(schemaIn(config).body).toEqual(copy);
  });

  it("warns when no login flow offers the method it enabled", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [passwordFlow]);

    const change = enableMethod(config, schemaIn(config), "passkey");

    expect(change.notices).toEqual([
      {
        severity: "warning",
        message: expect.stringContaining("No login flow for customers offers passkey yet."),
      },
    ]);
  });

  it("refuses password on a schema with no identifier", () => {
    const config = configOf(schemaBody({ passkey: { enabled: true } }, null));

    const error = thrownBy(() => {
      enableMethod(config, schemaIn(config), "password");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: `${SCHEMA_PATH} has no x-identifier for password`,
      details: { file: SCHEMA_PATH, method: "password" },
    });
  });

  it("refuses password on a schema whose identifier is blank", () => {
    const config = configOf(schemaBody({ passkey: { enabled: true } }, " "));

    expect(
      thrownBy(() => {
        enableMethod(config, schemaIn(config), "password");
      }),
    ).toBeInstanceOf(RefusedEditError);
  });

  it("accepts a schema without x-auth-methods", () => {
    const config = configOf({ type: "object" });

    expect(methodsIn(enableMethod(config, schemaIn(config), "passkey").after)).toEqual({
      passkey: { enabled: true },
    });
  });

  it("ignores a malformed entry of another method", () => {
    const config = configOf(schemaBody({ password: true }));

    expect(methodsIn(enableMethod(config, schemaIn(config), "passkey").after)).toEqual({
      password: true,
      passkey: { enabled: true },
    });
  });

  it.each([
    ["x-auth-methods is not an object", []],
    ["x-auth-methods.passkey is not an object", { passkey: true }],
    ["x-auth-methods.passkey.enabled is not a boolean", { passkey: {} }],
    ["x-auth-methods.passkey.enabled is not a boolean", { passkey: { enabled: "true" } }],
  ])("refuses the edit when %s", (region, methods) => {
    const config = configOf(schemaBody(methods));

    const error = thrownBy(() => {
      enableMethod(config, schemaIn(config), "passkey");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: `${SCHEMA_PATH}: ${region}`,
      details: { file: SCHEMA_PATH, region },
    });
  });
});

describe("disableMethod", () => {
  it("switches only the named method", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
    );

    const change = disableMethod(config, schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      password: { enabled: true },
      passkey: { enabled: false },
    });
  });

  it("writes nothing for a method already off", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: false } }),
    );

    expect(disableMethod(config, schemaIn(config), "passkey").changed).toBe(false);
  });

  it("refuses to turn off a method a login flow still uses", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
      [passwordFlow],
    );

    const error = thrownBy(() => {
      disableMethod(config, schemaIn(config), "password");
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      details: { steps: [{ path: ".zitadel/flows/flow-0.json", step: "password" }] },
    });
  });

  it("refuses to turn off the last way to sign in", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const error = thrownBy(() => {
      disableMethod(config, schemaIn(config), "password");
    });

    expect(error).toBeInstanceOf(NoSignInLeftError);
    expect(error).toMatchObject({ disabling: "password", usable: ["password"], alternatives: ["passkey"] });
  });

  it("refuses a flow that still uses the method before the last way to sign in", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [passwordFlow]);

    expect(
      thrownBy(() => {
        disableMethod(config, schemaIn(config), "password");
      }),
    ).toBeInstanceOf(BrokenFlowsError);
  });

  it("turns off the last way to sign in when forced", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const change = disableMethod(config, schemaIn(config), "password", { force: true });

    expect(methodsIn(change.after)).toEqual({ password: { enabled: false } });
  });

  it("warns that a schema left with no way in is managed only through the API", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const change = disableMethod(config, schemaIn(config), "password", { force: true });

    expect(change.notices).toEqual([
      {
        severity: "warning",
        message:
          "customers is left with no way to sign in. Its users can only be managed through the API.",
      },
    ]);
  });

  it("refuses the edit when the method's entry is not the shape it edits", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: "yes" } }),
    );

    expect(
      thrownBy(() => {
        disableMethod(config, schemaIn(config), "passkey");
      }),
    ).toBeInstanceOf(RefusedEditError);
  });
});
