import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETUP_PRESET,
  getDefaultHumanUserSchema,
  getDefaultLoginFlow,
  SETUP_PRESETS,
} from "./defaults.js";
import { flowConfigSchema, schemaConfigSchema } from "./schemas.js";
import { validateFlowDefinition } from "./validate.js";

/**
 * Preset hygiene: every shipped bundle must be a flow the server would
 * accept, judged by the same validator `plan`/`apply` run. A preset that
 * fails here would fail every fresh `zitadel setup`.
 */
describe.each([...SETUP_PRESETS])("preset %s", (preset) => {
  it("renders a schema that passes the config Zod", () => {
    const schema = getDefaultHumanUserSchema({ preset });
    expect(schemaConfigSchema.safeParse(schema).success).toBe(true);
  });

  it("renders a flow that passes the config Zod and validates cleanly against its schema", () => {
    const schema = getDefaultHumanUserSchema({ preset });
    const flow = getDefaultLoginFlow({ preset, userSchemaUrl: "sch_TEST" });
    expect(flowConfigSchema.safeParse(flow).success).toBe(true);
    expect(validateFlowDefinition(flow, schema as object)).toEqual([]);
  });

  it("keeps the objectType stable across presets (same user type, different journey)", () => {
    const schema = getDefaultHumanUserSchema({ preset }) as { objectType?: string };
    expect(schema.objectType).toBe("human-user");
  });
});

describe("preset selection", () => {
  it("defaults to password-first", () => {
    expect(DEFAULT_SETUP_PRESET).toBe("password-first");
    expect(getDefaultLoginFlow()).toEqual(getDefaultLoginFlow({ preset: "password-first" }));
  });

  it("rejects an unknown preset naming the known ones", () => {
    expect(() => getDefaultLoginFlow({ preset: "topt-first" })).toThrowError(
      /unknown setup preset "topt-first".*password-first.*passkey-first/,
    );
  });

  it("rejects prototype-chain keys as unknown presets", () => {
    for (const preset of ["__proto__", "constructor", "toString"]) {
      expect(() => getDefaultLoginFlow({ preset })).toThrowError(/unknown setup preset/);
      expect(() => getDefaultHumanUserSchema({ preset })).toThrowError(/unknown setup preset/);
    }
  });
});

describe("passkey-first preset shape", () => {
  const schema = getDefaultHumanUserSchema({ preset: "passkey-first" }) as unknown as {
    "x-auth-methods": Record<string, { enabled: boolean }>;
    required: string[];
  };
  const flow = getDefaultLoginFlow({ preset: "passkey-first", userSchemaUrl: "sch_TEST" });

  // The schema says which methods exist, not the order they are offered in —
  // that is the flow's entry step (asserted below).
  it("enables passkey and keeps password as the fallback method", () => {
    expect(schema["x-auth-methods"].passkey).toEqual({ enabled: true });
    expect(schema["x-auth-methods"].password).toEqual({ enabled: true });
  });

  it("keeps email required so the fallback path always works", () => {
    expect(schema.required).toContain("email");
  });

  it("enters login on a fields-less passkey step with an email fallback", () => {
    expect(flow.purposes).toMatchObject({ login: "passkey-first", register: "register" });
    const entry = flow.steps.find((s) => s.name === "passkey-first");
    expect(entry?.fields ?? []).toEqual([]);
    expect(entry?.actions?.[0]).toMatchObject({ kind: "passkey", primary: true });
    expect(entry?.transitions).toMatchObject({
      passkey: { target: "done" },
      email_fallback: { target: "identifier" },
      user_not_found: { target: "register" },
    });
  });

  it("registers with the passkey as the primary action", () => {
    const register = flow.steps.find((s) => s.name === "register");
    expect(register?.actions?.[0]).toMatchObject({ kind: "passkey_register", primary: true });
  });
});
