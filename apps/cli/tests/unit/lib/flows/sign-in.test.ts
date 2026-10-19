import { describe, expect, it } from "vitest";

import { checkFlow, offeredSignInMethods } from "../../../../src/lib/flows";

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

describe("checkFlow", () => {
  it("names the step that still collects a disabled password", () => {
    const before = schema({ password: { enabled: true } });
    const after = schema({ password: { enabled: false } });

    const check = checkFlow(passwordFlow, before, after);

    expect(check.kind === "checked" && check.introduced.map((issue) => issue.step)).toEqual([
      "password",
    ]);
  });

  it("names the step that still offers a disabled passkey", () => {
    const before = schema({ passkey: { enabled: true } });
    const after = schema({ passkey: { enabled: false } });

    const check = checkFlow(passkeyFlow, before, after);

    expect(check).toEqual({
      kind: "checked",
      introduced: [
        expect.objectContaining({ rule: "schema/passkey-actions", step: "passkey-first" }),
      ],
    });
  });

  it("finds nothing when the flow never used the method", () => {
    const before = schema({ password: { enabled: true }, passkey: { enabled: true } });
    const after = schema({ password: { enabled: true }, passkey: { enabled: false } });

    expect(checkFlow(passwordFlow, before, after)).toEqual({ kind: "checked", introduced: [] });
  });

  it("ignores schema errors the flow already had", () => {
    // Password is already off, so the password step is already an error.
    const before = schema({ password: { enabled: false }, passkey: { enabled: true } });
    const after = schema({ password: { enabled: false }, passkey: { enabled: false } });

    expect(checkFlow(passwordFlow, before, after)).toEqual({ kind: "checked", introduced: [] });
  });

  it("reports a malformed flow file as unchecked", () => {
    // A string where `fields` should be a list reads as no fields to the
    // semantic validator, which would hide the password step.
    const malformed = {
      ...passwordFlow,
      steps: [
        passwordFlow.steps[0],
        { ...passwordFlow.steps[1], fields: "x-auth-methods#password" },
        passwordFlow.steps[2],
      ],
    };
    const before = schema({ password: { enabled: true } });
    const after = schema({ password: { enabled: false } });

    expect(checkFlow(malformed, before, after).kind).toBe("unchecked");
  });

  it("reports a structurally broken flow as unchecked rather than unaffected", () => {
    // A structural error stops the validator before the schema rules, so the
    // password step would otherwise go unnoticed.
    const broken = { ...passwordFlow, purposes: { login: "identifier", register: "missing" } };
    const before = schema({ password: { enabled: true } });
    const after = schema({ password: { enabled: false } });

    const check = checkFlow(broken, before, after);

    expect(check.kind).toBe("unchecked");
  });
});

describe("offeredSignInMethods", () => {
  it("sees password on a step that collects it", () => {
    expect(offeredSignInMethods([passwordFlow], [])).toEqual(["password"]);
  });

  it("sees passkey on a step that offers the action", () => {
    expect(offeredSignInMethods([passkeyFlow], [])).toEqual(["passkey"]);
  });

  it("ignores a flow that is not active", () => {
    expect(offeredSignInMethods([{ ...passkeyFlow, status: "draft" }], [])).toEqual([]);
  });

  it("does not count a register-only flow that collects a password", () => {
    const registerOnly = {
      status: "active",
      purposes: { register: "register" },
      steps: [{ name: "register", fields: ["email", "x-auth-methods#password"] }],
    };

    expect(offeredSignInMethods([registerOnly], [])).toEqual([]);
  });

  it("does not count register steps of a flow that also signs in", () => {
    // The login journey offers passkey only; password is collected on the
    // register side, which the login steps hand over to with a purpose flip.
    const combined = {
      status: "active",
      purposes: { login: "start", register: "register" },
      steps: [
        {
          name: "start",
          actions: [{ name: "passkey", kind: "passkey" }],
          transitions: { register: { target: "register", purpose: "register" } },
        },
        { name: "register", fields: ["x-auth-methods#password"] },
      ],
    };

    expect(offeredSignInMethods([combined], [])).toEqual(["passkey"]);
  });

  it("follows a local transition with null action and purpose", () => {
    const flow = {
      status: "active",
      purposes: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          transitions: { submit: { target: "password", action: null, purpose: null } },
        },
        { name: "password", fields: ["x-auth-methods#password"] },
      ],
    };

    expect(offeredSignInMethods([flow], [])).toEqual(["password"]);
  });

  it("does not follow a transition into another flow", () => {
    // `switch` targets a step of another flow that shares a name with a local
    // one.
    const flow = {
      status: "active",
      purposes: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          transitions: { other: { target: "password", action: "switch" } },
        },
        { name: "password", fields: ["x-auth-methods#password"] },
      ],
    };

    expect(offeredSignInMethods([flow], [])).toEqual([]);
  });

  it("stops at an outcome that switches to registration on its own", () => {
    // The shipped shape: user_not_found routes to register with no purpose.
    const flow = {
      status: "active",
      purposes: { login: "identifier", register: "register" },
      steps: [
        {
          name: "identifier",
          actions: [{ name: "passkey", kind: "passkey" }],
          transitions: { user_not_found: { target: "register" } },
        },
        { name: "register", fields: ["x-auth-methods#password"] },
      ],
    };

    expect(offeredSignInMethods([flow], [])).toEqual(["passkey"]);
  });

  it("does not count a flow that only registers passkeys", () => {
    const registerOnly = {
      status: "active",
      steps: [{ name: "register", actions: [{ name: "enrol", kind: "passkey_register" }] }],
    };

    expect(offeredSignInMethods([registerOnly], [])).toEqual([]);
  });

  it("does not count SSO for a provider it was not given", () => {
    const githubFlow = {
      status: "active",
      purposes: { login: "identifier" },
      steps: [{ name: "identifier", sso_providers: ["github"] }],
    };

    expect(offeredSignInMethods([githubFlow], ["google"])).toEqual([]);
  });

  it("counts SSO on a step that names a provider it was given", () => {
    const ssoFlow = {
      status: "active",
      purposes: { login: "identifier" },
      steps: [{ name: "identifier", sso_providers: ["google"] }],
    };

    expect(offeredSignInMethods([ssoFlow], ["google"])).toEqual(["sso"]);
  });
});
