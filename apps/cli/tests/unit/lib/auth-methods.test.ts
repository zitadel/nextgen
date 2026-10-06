import { describe, expect, it } from "vitest";

import {
  enabledSignInMethods,
  flowOffers,
  introducedFlowErrors,
  setAuthModes,
} from "../../../src/lib/auth-methods";

const schema = (methods: Record<string, unknown>): Record<string, unknown> => ({
  type: "object",
  "x-identifier": "email",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
  "x-auth-methods": methods,
});

/** The shipped password flow, cut to the steps the validator needs. */
const passwordFlow = {
  name: "default-login",
  status: "active",
  user_schema: "https://schemas.test.invalid/default-human-user.json",
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

const passkeyFlow = {
  ...passwordFlow,
  purposes: { login: "passkey-first" },
  steps: [
    {
      name: "passkey-first",
      fields: [],
      actions: [{ name: "passkey", kind: "passkey", primary: true }],
      transitions: { passkey: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
};

describe("setAuthModes", () => {
  it("switches only the named mode", () => {
    const before = schema({ password: { enabled: true }, passkey: { enabled: true } });

    const result = setAuthModes(before, ["passkey"], false);

    expect(result.changed).toEqual(["passkey"]);
    expect(result.document["x-auth-methods"]).toEqual({
      password: { enabled: true },
      passkey: { enabled: false },
    });
  });

  it("keeps the other keys under the method and the other methods", () => {
    const before = schema({
      passkey: { enabled: false, user_verification: "required" },
      sso: { enabled: true, providers: ["google"] },
    });

    const result = setAuthModes(before, ["passkey"], true);

    expect(result.document["x-auth-methods"]).toEqual({
      passkey: { enabled: true, user_verification: "required" },
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("adds a method the schema does not mention", () => {
    const result = setAuthModes(schema({ password: { enabled: true } }), ["passkey"], true);

    expect(result.document["x-auth-methods"]).toMatchObject({ passkey: { enabled: true } });
  });

  it("reports a mode already in the requested state as unchanged and returns the input", () => {
    const before = schema({ password: { enabled: true } });

    const result = setAuthModes(before, ["password"], true);

    expect(result).toEqual({ document: before, changed: [], unchanged: ["password"] });
  });

  it("does not mutate the schema it was given", () => {
    const before = schema({ password: { enabled: true } });
    const copy = structuredClone(before);

    setAuthModes(before, ["password"], false);

    expect(before).toEqual(copy);
  });
});

describe("enabledSignInMethods", () => {
  it("counts SSO as a way in", () => {
    const methods = enabledSignInMethods(
      schema({ password: { enabled: false }, sso: { enabled: true, providers: ["google"] } }),
    );

    expect(methods).toEqual(["sso"]);
  });

  it("is empty for a schema without x-auth-methods", () => {
    expect(enabledSignInMethods({ type: "object" })).toEqual([]);
  });
});

describe("introducedFlowErrors", () => {
  it("names the step that still collects a disabled password", () => {
    const before = schema({ password: { enabled: true } });
    const after = schema({ password: { enabled: false } });

    const issues = introducedFlowErrors(passwordFlow, before, after);

    expect(issues.map((issue) => issue.step)).toEqual(["password"]);
  });

  it("names the step that still offers a disabled passkey", () => {
    const before = schema({ passkey: { enabled: true } });
    const after = schema({ passkey: { enabled: false } });

    const issues = introducedFlowErrors(passkeyFlow, before, after);

    expect(issues).toEqual([
      expect.objectContaining({ rule: "schema/passkey-actions", step: "passkey-first" }),
    ]);
  });

  it("finds nothing when the flow never used the method", () => {
    const before = schema({ password: { enabled: true }, passkey: { enabled: true } });
    const after = schema({ password: { enabled: true }, passkey: { enabled: false } });

    expect(introducedFlowErrors(passwordFlow, before, after)).toEqual([]);
  });

  it("ignores errors the flow already had", () => {
    const broken = { ...passwordFlow, purposes: { login: "missing" } };
    const before = schema({ password: { enabled: true }, passkey: { enabled: true } });
    const after = schema({ password: { enabled: true }, passkey: { enabled: false } });

    expect(introducedFlowErrors(broken, before, after)).toEqual([]);
  });
});

describe("flowOffers", () => {
  it("sees password on a step that collects it", () => {
    expect(flowOffers(passwordFlow, "password")).toBe(true);
    expect(flowOffers(passwordFlow, "passkey")).toBe(false);
  });

  it("sees passkey on a step that offers the action", () => {
    expect(flowOffers(passkeyFlow, "passkey")).toBe(true);
    expect(flowOffers(passkeyFlow, "password")).toBe(false);
  });
});
