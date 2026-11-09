import { describe, expect, it } from "vitest";

import {
  BrokenFlowsError,
  NoSignInLeftError,
  RefusedEditError,
  type UserSchema,
  ZitadelConfig,
} from "@/lib/zitadel";
import type { SchemaEdit, ToggleableMethod } from "@/lib/zitadel/resources/schemas/types";
import type { JsonObject } from "@/lib/zitadel/types";
import { thrownBy } from "@tests/helpers/thrown-value";

/**
 * Where the schema in these tests sits.
 */
const SCHEMA_PATH = ".zitadel/schemas/customers.json";

/**
 * The `$id` the flows name the schema by.
 */
const SCHEMA_ID = "https://schemas.test.invalid/customers.json";

/**
 * Where the first flow in these tests sits.
 */
const FLOW_PATH = ".zitadel/flows/login.json";

/**
 * A user schema that enables these methods.
 *
 * @param methods - Its `x-auth-methods`.
 * @param identifier - Its `x-identifier`, or `null` for none.
 * @returns The schema's body.
 */
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

/**
 * The configuration with one schema and these flows.
 *
 * @param schema - The schema's body.
 * @param flows - The flows' bodies; the first sits at {@link FLOW_PATH}.
 * @returns The configuration.
 */
function configOf(schema: JsonObject, flows: readonly JsonObject[] = []): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [{ path: SCHEMA_PATH, body: schema }],
    flows: flows.map((body, index) => {
      if (index === 0) {
        return { path: FLOW_PATH, body };
      }
      return { path: `.zitadel/flows/flow-${index}.json`, body };
    }),
    connections: [],
    policies: [],
    branding: [],
  });
}

/**
 * The configuration's only schema.
 *
 * @param config - The configuration.
 * @returns The schema.
 * @throws {@link Error} When the configuration has no schema.
 */
function schemaIn(config: ZitadelConfig): UserSchema {
  const schema = config.schemas.get(SCHEMA_PATH);
  if (schema === undefined) {
    throw new Error("the configuration has no schema");
  }
  return schema;
}

/**
 * The edit that replaces the schema with what `change` makes of it.
 *
 * @param config - The configuration.
 * @param change - What to make of the schema.
 * @returns The edit.
 */
function editOf(config: ZitadelConfig, change: (schema: UserSchema) => UserSchema): SchemaEdit {
  const original = schemaIn(config);
  const edited = change(original);
  return { before: config, after: config.with(edited), original, edited };
}

/**
 * The edit that switches a method on or off.
 *
 * @param config - The configuration, whose schema is edited.
 * @param method - The method.
 * @param enabled - The state to put it in.
 * @returns The edit.
 */
function toggled(config: ZitadelConfig, method: ToggleableMethod, enabled: boolean): SchemaEdit {
  return editOf(config, (schema) => {
    return enabled ? schema.withMethod(method) : schema.withoutMethod(method);
  });
}

/**
 * A flow whose login journey collects a password.
 */
const passwordFlow = {
  status: "active",
  user_schema: SCHEMA_ID,
  purposes: { login: "password" },
  steps: [{ name: "password", fields: ["x-auth-methods#password"] }],
};

/**
 * A flow whose login journey offers a passkey.
 */
const passkeyFlow = {
  status: "active",
  user_schema: SCHEMA_ID,
  purposes: { login: "passkey" },
  steps: [{ name: "passkey", actions: [{ name: "passkey", kind: "passkey" }] }],
};

/**
 * A flow whose login journey offers these providers.
 *
 * @param providers - The providers its entry step lists.
 * @returns The flow's body.
 */
const ssoFlow = (providers: string[]): JsonObject => {
  return {
    status: "active",
    user_schema: SCHEMA_ID,
    purposes: { login: "identifier" },
    steps: [{ name: "identifier", sso_providers: providers }],
  };
};

/** The `x-auth-methods` a configuration's schema holds. */
function methodsIn(config: ZitadelConfig): unknown {
  return schemaIn(config).body["x-auth-methods"];
}

/** A flow whose login journey asks for an identifier, then a password. */
const loginFlow = {
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

describe("Schemas.enable", () => {
  it("switches only the named method", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: false } }),
    );

    const change = config.schemas.enable(schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      password: { enabled: true },
      passkey: { enabled: true },
    });
  });

  it("keeps the other methods as they are", () => {
    const config = configOf(
      schemaBody({ passkey: { enabled: false }, sso: { enabled: true, providers: ["google"] } }),
    );

    const change = config.schemas.enable(schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      passkey: { enabled: true },
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("keeps what else the method's entry holds", () => {
    const config = configOf(
      schemaBody({ passkey: { enabled: false, user_verification: "required" } }),
    );

    const change = config.schemas.enable(schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      passkey: { enabled: true, user_verification: "required" },
    });
  });

  it("adds a method the schema does not mention", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const change = config.schemas.enable(schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toMatchObject({ passkey: { enabled: true } });
  });

  it("writes the schema", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    expect(config.schemas.enable(schemaIn(config), "passkey").changedPaths).toEqual([SCHEMA_PATH]);
  });

  it("writes nothing for a method already on", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [loginFlow]);

    const change = config.schemas.enable(schemaIn(config), "password");

    expect(change.changed).toBe(false);
  });

  it("does not change the configuration it was given", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));
    const copy = structuredClone(schemaIn(config).body);

    config.schemas.enable(schemaIn(config), "passkey");

    expect(schemaIn(config).body).toEqual(copy);
  });

  it("warns when no login flow offers the method it enabled", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [loginFlow]);

    const change = config.schemas.enable(schemaIn(config), "passkey");

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
      config.schemas.enable(schemaIn(config), "password");
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
        config.schemas.enable(schemaIn(config), "password");
      }),
    ).toBeInstanceOf(RefusedEditError);
  });

  it("accepts a schema without x-auth-methods", () => {
    const config = configOf({ type: "object" });

    expect(methodsIn(config.schemas.enable(schemaIn(config), "passkey").after)).toEqual({
      passkey: { enabled: true },
    });
  });

  it("ignores a malformed entry of another method", () => {
    const config = configOf(schemaBody({ password: true }));

    expect(methodsIn(config.schemas.enable(schemaIn(config), "passkey").after)).toEqual({
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
      config.schemas.enable(schemaIn(config), "passkey");
    });

    expect(error).toBeInstanceOf(RefusedEditError);
    expect(error).toMatchObject({
      message: `${SCHEMA_PATH}: ${region}`,
      details: { file: SCHEMA_PATH, region },
    });
  });
});

describe("Schemas.disable", () => {
  it("switches only the named method", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
    );

    const change = config.schemas.disable(schemaIn(config), "passkey");

    expect(methodsIn(change.after)).toEqual({
      password: { enabled: true },
      passkey: { enabled: false },
    });
  });

  it("writes nothing for a method already off", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: false } }),
    );

    expect(config.schemas.disable(schemaIn(config), "passkey").changed).toBe(false);
  });

  it("refuses to turn off a method a login flow still uses", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
      [loginFlow],
    );

    const error = thrownBy(() => {
      config.schemas.disable(schemaIn(config), "password");
    });

    expect(error).toBeInstanceOf(BrokenFlowsError);
    expect(error).toMatchObject({
      details: { steps: [{ path: FLOW_PATH, step: "password" }] },
    });
  });

  it("refuses to turn off the last way to sign in", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const error = thrownBy(() => {
      config.schemas.disable(schemaIn(config), "password");
    });

    expect(error).toBeInstanceOf(NoSignInLeftError);
    expect(error).toMatchObject({ disabling: "password", usable: ["password"], alternatives: ["passkey"] });
  });

  it("refuses a flow that still uses the method before the last way to sign in", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [loginFlow]);

    expect(
      thrownBy(() => {
        config.schemas.disable(schemaIn(config), "password");
      }),
    ).toBeInstanceOf(BrokenFlowsError);
  });

  it("turns off the last way to sign in when forced", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const change = config.schemas.disable(schemaIn(config), "password", { force: true });

    expect(methodsIn(change.after)).toEqual({ password: { enabled: false } });
  });

  it("warns that a schema left with no way in is managed only through the API", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }));

    const change = config.schemas.disable(schemaIn(config), "password", { force: true });

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
        config.schemas.disable(schemaIn(config), "passkey");
      }),
    ).toBeInstanceOf(RefusedEditError);
  });
});

describe("Schemas.reachableMethods", () => {
  it("counts only methods an active flow offers", () => {
    // The shipped default: passkey is enabled, but the flow offers password
    // only.
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
      [passwordFlow],
    );

    expect(config.schemas.reachableMethods(schemaIn(config))).toEqual(["password"]);
  });

  it("is empty when the flow offers nothing the schema enables", () => {
    const config = configOf(
      schemaBody({ password: { enabled: false }, passkey: { enabled: true } }),
      [passwordFlow],
    );

    expect(config.schemas.reachableMethods(schemaIn(config))).toEqual([]);
  });

  it("does not count a flow that is not active", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [
      { ...passwordFlow, status: "draft" },
    ]);

    expect(config.schemas.reachableMethods(schemaIn(config))).toEqual([]);
  });

  it("does not count a flow that runs against another schema", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [
      { ...passwordFlow, user_schema: "https://schemas.test.invalid/staff.json" },
    ]);

    expect(config.schemas.reachableMethods(schemaIn(config))).toEqual([]);
  });

  it("does not count SSO for a provider the schema does not enable", () => {
    const config = configOf(schemaBody({ sso: { enabled: true, providers: ["google"] } }), [
      ssoFlow(["github"]),
    ]);

    expect(config.schemas.reachableMethods(schemaIn(config))).toEqual([]);
  });

  it("counts SSO on a step that names a provider the schema enables", () => {
    const config = configOf(schemaBody({ sso: { enabled: true, providers: ["google"] } }), [
      ssoFlow(["google"]),
    ]);

    expect(config.schemas.reachableMethods(schemaIn(config))).toEqual(["sso"]);
  });

  it("does not count SSO whose providers are not valid slugs", () => {
    const config = configOf(schemaBody({ sso: { enabled: true, providers: ["Not A Slug"] } }), [
      ssoFlow(["Not A Slug"]),
    ]);

    expect(config.schemas.reachableMethods(schemaIn(config))).toEqual([]);
  });
});

describe("Schemas.assertSignInLeft", () => {
  const passwordOnly = (identifier?: string): ZitadelConfig => {
    return configOf(schemaBody({ password: { enabled: true } }, identifier));
  };

  const refusalOf = (edit: SchemaEdit, disabling: string): NoSignInLeftError => {
    const error = thrownBy(() => {
      edit.before.schemas.assertSignInLeft(edit, disabling, false);
    });
    expect(error).toBeInstanceOf(NoSignInLeftError);
    return error as NoSignInLeftError;
  };

  it("refuses an edit that turns off the last way to sign in", () => {
    const error = refusalOf(toggled(passwordOnly(), "password", false), "password");

    expect(error).toMatchObject({ path: SCHEMA_PATH, schema: "customers", disabling: "password" });
  });

  it("offers every method the schema did not enable, leaving out the one turned off", () => {
    const error = refusalOf(toggled(passwordOnly(), "password", false), "password");

    expect(error.alternatives).toEqual(["passkey"]);
  });

  it("names the methods the schema enabled before the change", () => {
    const error = refusalOf(toggled(passwordOnly(), "password", false), "password");

    expect(error.usable).toEqual(["password"]);
  });

  it("offers password only to a schema with an identifier", () => {
    const config = configOf(schemaBody({ passkey: { enabled: true } }, null));

    const error = refusalOf(toggled(config, "passkey", false), "passkey");

    expect(error.alternatives).toEqual([]);
  });

  it("does not offer password to a schema whose identifier is blank", () => {
    const config = configOf(schemaBody({ passkey: { enabled: true } }, " "));

    const error = refusalOf(toggled(config, "passkey", false), "passkey");

    expect(error.alternatives).toEqual([]);
  });

  it("names the provider being removed", () => {
    const config = configOf(schemaBody({ sso: { enabled: true, providers: ["google"] } }));
    const edit = editOf(config, (schema) => {
      return schema.withoutProvider("google");
    });

    expect(refusalOf(edit, "google").disabling).toBe("google");
  });

  it("makes the edit anyway when forced", () => {
    const edit = toggled(passwordOnly(), "password", false);

    expect(() => {
      edit.before.schemas.assertSignInLeft(edit, "password", true);
    }).not.toThrow();
  });

  it("allows an edit that leaves another way in", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
    );

    expect(() => {
      config.schemas.assertSignInLeft(toggled(config, "password", false), "password", false);
    }).not.toThrow();
  });

  it("allows an edit to a schema that had no way in already", () => {
    const config = configOf(schemaBody({ password: { enabled: false }, otp: { enabled: true } }));

    expect(() => {
      config.schemas.assertSignInLeft(toggled(config, "passkey", false), "passkey", false);
    }).not.toThrow();
  });

  it.each([
    ["SSO without a provider", { sso: { enabled: true, providers: [] } }],
    ["SSO whose providers are not valid slugs", { sso: { enabled: true, providers: [7, ""] } }],
    ["a method the login engine cannot serve", { otp: { enabled: true } }],
  ])("does not count %s as a way in", (_, others) => {
    const config = configOf(schemaBody({ password: { enabled: true }, ...others }));

    expect(refusalOf(toggled(config, "password", false), "password")).toBeInstanceOf(
      NoSignInLeftError,
    );
  });
});

describe("Schemas.signInNotices", () => {
  const messagesOf = (edit: SchemaEdit, enabled?: ToggleableMethod): readonly string[] => {
    return edit.before.schemas.signInNotices(edit, enabled).map((notice) => {
      expect(notice.severity).toBe("warning");
      return notice.message;
    });
  };

  it("says nothing when an enabled method is offered", () => {
    const config = configOf(schemaBody({ password: { enabled: false } }), [passwordFlow]);

    expect(messagesOf(toggled(config, "password", true), "password")).toEqual([]);
  });

  it("says no login flow offers a method that was enabled, and where to offer it", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [passwordFlow]);

    expect(messagesOf(toggled(config, "passkey", true), "passkey")).toEqual([
      `No login flow for customers offers passkey yet. In ${FLOW_PATH}, add a "kind": "passkey" action to a step reached from purposes.login, plus a transition under the action's name. A "kind": "passkey_register" action does the same for sign-up. See .zitadel/flows/README.md.`,
    ]);
  });

  it("says how to offer a password", () => {
    const config = configOf(schemaBody({ passkey: { enabled: true } }), [passkeyFlow]);

    expect(messagesOf(toggled(config, "password", true), "password")).toEqual([
      `No login flow for customers offers password yet. In ${FLOW_PATH}, add "x-auth-methods#password" to the fields of a step reached from purposes.login, with a "kind": "submit" action and a transition under its name. See .zitadel/flows/README.md.`,
    ]);
  });

  it("names every login flow the method could go in", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [
      passwordFlow,
      passwordFlow,
    ]);

    expect(messagesOf(toggled(config, "passkey", true), "passkey")[0]).toContain(
      `In ${FLOW_PATH} or .zitadel/flows/flow-1.json, add`,
    );
  });

  it("points at the flows directory when no flow signs anyone in", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [
      { ...passwordFlow, status: "draft" },
    ]);

    expect(messagesOf(toggled(config, "passkey", true), "passkey")[0]).toContain(
      "In an active login flow for customers in .zitadel/flows/, add",
    );
  });

  it("says nobody can sign in when no flow offers any method the schema enables", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
      [passkeyFlow],
    );

    expect(messagesOf(toggled(config, "passkey", false))).toEqual([
      "No active login flow for customers offers a method it enables, so nobody can sign in until one does.",
    ]);
  });

  it("says a schema left with no way in is managed only through the API", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [passwordFlow]);

    expect(messagesOf(toggled(config, "password", false))).toEqual([
      "customers is left with no way to sign in. Its users can only be managed through the API.",
    ]);
  });
});
