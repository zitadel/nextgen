import { describe, expect, it } from "vitest";

import { NoSignInLeftError, type UserSchema, ZitadelConfig } from "@/lib/zitadel";
import { assertSignInLeft, reachableMethods, signInNotices } from "@/lib/zitadel/schemas/signin";
import type { JsonObject } from "@/lib/zitadel/types";
import type { SchemaEdit, ToggleableMethod } from "@/lib/zitadel/schemas/types";
import { thrownBy } from "@tests/helpers/thrown-value";

const SCHEMA_PATH = ".zitadel/schemas/customers.json";
const SCHEMA_ID = "https://schemas.test.invalid/customers.json";
const FLOW_PATH = ".zitadel/flows/login.json";

/** A user schema that enables these methods, with no identifier when it is `null`. */
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

/** The configuration's only schema. */
function schemaIn(config: ZitadelConfig): UserSchema {
  const schema = config.schema(SCHEMA_PATH);
  if (schema === undefined) {
    throw new Error("the configuration has no schema");
  }
  return schema;
}

/** The edit that replaces the schema with what `change` makes of it. */
function editOf(config: ZitadelConfig, change: (schema: UserSchema) => UserSchema): SchemaEdit {
  const original = schemaIn(config);
  const edited = change(original);
  return { before: config, after: config.with(edited), original, edited };
}

/** The edit that switches a method on or off. */
function toggled(config: ZitadelConfig, method: ToggleableMethod, enabled: boolean): SchemaEdit {
  return editOf(config, (schema) => {
    return schema.withMethod(method, enabled);
  });
}

/** A flow whose login journey collects a password. */
const passwordFlow = {
  status: "active",
  user_schema: SCHEMA_ID,
  purposes: { login: "password" },
  steps: [{ name: "password", fields: ["x-auth-methods#password"] }],
};

/** A flow whose login journey offers a passkey. */
const passkeyFlow = {
  status: "active",
  user_schema: SCHEMA_ID,
  purposes: { login: "passkey" },
  steps: [{ name: "passkey", actions: [{ name: "passkey", kind: "passkey" }] }],
};

/** A flow whose login journey offers these providers. */
const ssoFlow = (providers: string[]): JsonObject => {
  return {
    status: "active",
    user_schema: SCHEMA_ID,
    purposes: { login: "identifier" },
    steps: [{ name: "identifier", sso_providers: providers }],
  };
};

describe("reachableMethods", () => {
  it("counts only methods an active flow offers", () => {
    // The shipped default: passkey is enabled, but the flow offers password
    // only.
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
      [passwordFlow],
    );

    expect(reachableMethods(config, schemaIn(config))).toEqual(["password"]);
  });

  it("is empty when the flow offers nothing the schema enables", () => {
    const config = configOf(
      schemaBody({ password: { enabled: false }, passkey: { enabled: true } }),
      [passwordFlow],
    );

    expect(reachableMethods(config, schemaIn(config))).toEqual([]);
  });

  it("does not count a flow that is not active", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [
      { ...passwordFlow, status: "draft" },
    ]);

    expect(reachableMethods(config, schemaIn(config))).toEqual([]);
  });

  it("does not count a flow that runs against another schema", () => {
    const config = configOf(schemaBody({ password: { enabled: true } }), [
      { ...passwordFlow, user_schema: "https://schemas.test.invalid/staff.json" },
    ]);

    expect(reachableMethods(config, schemaIn(config))).toEqual([]);
  });

  it("does not count SSO for a provider the schema does not enable", () => {
    const config = configOf(schemaBody({ sso: { enabled: true, providers: ["google"] } }), [
      ssoFlow(["github"]),
    ]);

    expect(reachableMethods(config, schemaIn(config))).toEqual([]);
  });

  it("counts SSO on a step that names a provider the schema enables", () => {
    const config = configOf(schemaBody({ sso: { enabled: true, providers: ["google"] } }), [
      ssoFlow(["google"]),
    ]);

    expect(reachableMethods(config, schemaIn(config))).toEqual(["sso"]);
  });

  it("does not count SSO whose providers are not valid slugs", () => {
    const config = configOf(schemaBody({ sso: { enabled: true, providers: ["Not A Slug"] } }), [
      ssoFlow(["Not A Slug"]),
    ]);

    expect(reachableMethods(config, schemaIn(config))).toEqual([]);
  });
});

describe("assertSignInLeft", () => {
  const passwordOnly = (identifier?: string): ZitadelConfig => {
    return configOf(schemaBody({ password: { enabled: true } }, identifier));
  };

  const refusalOf = (edit: SchemaEdit, disabling: string): NoSignInLeftError => {
    const error = thrownBy(() => {
      assertSignInLeft(edit, disabling, false);
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
      assertSignInLeft(edit, "password", true);
    }).not.toThrow();
  });

  it("allows an edit that leaves another way in", () => {
    const config = configOf(
      schemaBody({ password: { enabled: true }, passkey: { enabled: true } }),
    );

    expect(() => {
      assertSignInLeft(toggled(config, "password", false), "password", false);
    }).not.toThrow();
  });

  it("allows an edit to a schema that had no way in already", () => {
    const config = configOf(schemaBody({ password: { enabled: false }, otp: { enabled: true } }));

    expect(() => {
      assertSignInLeft(toggled(config, "passkey", false), "passkey", false);
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

describe("signInNotices", () => {
  const messagesOf = (edit: SchemaEdit, enabled?: ToggleableMethod): readonly string[] => {
    return signInNotices(edit, enabled).map((notice) => {
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
