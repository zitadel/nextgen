import { describe, expect, it } from "vitest";

import { Flow } from "@/lib/zitadel";
import type { JsonObject } from "@/lib/zitadel/types";

/** A flow read from `.zitadel/flows/`. */
function flowOf(body: JsonObject): Flow {
  return Flow.of({ path: ".zitadel/flows/login.json", body });
}

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

/** A flow whose login entry offers a passkey. */
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

/** The passkey-first preset, cut to the steps and transitions that matter here. */
const passkeyFirstFlow = {
  purposes: { login: "passkey-first", register: "register" },
  steps: [
    {
      name: "passkey-first",
      fields: [],
      actions: [
        { name: "passkey", kind: "passkey" },
        { name: "email_fallback", kind: "navigate" },
      ],
      transitions: { passkey: { target: "done" }, email_fallback: { target: "identifier" } },
    },
    {
      name: "identifier",
      fields: ["email"],
      actions: [
        { name: "submit", kind: "submit" },
        { name: "passkey", kind: "passkey" },
      ],
      transitions: { submit: { target: "password" }, passkey: { target: "done" } },
    },
    {
      name: "password",
      fields: ["x-auth-methods#password"],
      actions: [
        { name: "submit", kind: "submit" },
        { name: "passkey", kind: "passkey" },
      ],
      transitions: { submit: { target: "done" }, passkey: { target: "done" } },
    },
    {
      name: "register",
      fields: ["email"],
      actions: [{ name: "sign_in", kind: "navigate" }],
      transitions: { sign_in: { purpose: "login" } },
    },
    {
      name: "sso-conflict",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "sign_in", kind: "navigate" }],
      transitions: { sign_in: { purpose: "login", target: "passkey-first" } },
    },
    { name: "done", complete: "show" },
  ],
};

describe("Flow.offeredMethods", () => {
  it("sees password on a step that collects it", () => {
    expect(flowOf(passwordFlow).offeredMethods([])).toEqual(["password"]);
  });

  it("sees passkey on a step that offers the action", () => {
    expect(flowOf(passkeyFlow).offeredMethods([])).toEqual(["passkey"]);
  });

  it("ignores a flow that is not active", () => {
    expect(flowOf({ ...passkeyFlow, status: "draft" }).offeredMethods([])).toEqual([]);
  });

  it("does not count a register-only flow that collects a password", () => {
    const registerOnly = {
      status: "active",
      purposes: { register: "register" },
      steps: [{ name: "register", fields: ["email", "x-auth-methods#password"] }],
    };

    expect(flowOf(registerOnly).offeredMethods([])).toEqual([]);
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

    expect(flowOf(combined).offeredMethods([])).toEqual(["passkey"]);
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

    expect(flowOf(flow).offeredMethods([])).toEqual(["password"]);
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

    expect(flowOf(flow).offeredMethods([])).toEqual([]);
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

    expect(flowOf(flow).offeredMethods([])).toEqual(["passkey"]);
  });

  it("does not count a flow that only registers passkeys", () => {
    const registerOnly = {
      status: "active",
      purposes: { login: "register" },
      steps: [{ name: "register", actions: [{ name: "enrol", kind: "passkey_register" }] }],
    };

    expect(flowOf(registerOnly).offeredMethods([])).toEqual([]);
  });

  it("does not count SSO for a provider it was not given", () => {
    const githubFlow = {
      status: "active",
      purposes: { login: "identifier" },
      steps: [{ name: "identifier", sso_providers: ["github"] }],
    };

    expect(flowOf(githubFlow).offeredMethods(["google"])).toEqual([]);
  });

  it("counts SSO on a step that names a provider it was given", () => {
    const ssoFlow = {
      status: "active",
      purposes: { login: "identifier" },
      steps: [{ name: "identifier", sso_providers: ["google"] }],
    };

    expect(flowOf(ssoFlow).offeredMethods(["google"])).toEqual(["sso"]);
  });
});

describe("Flow.methodUses", () => {
  it("says what a step keeps without a password and which transitions lead to it", () => {
    expect(flowOf(passkeyFirstFlow).methodUses("password", ["passkey"])).toEqual([
      {
        step: "password",
        uses: "collects password",
        keeps: ['passkey action "passkey"'],
        entryFor: [],
        targetedBy: [{ step: "identifier", transition: "submit" }],
      },
      {
        step: "sso-conflict",
        uses: "collects password",
        keeps: [],
        entryFor: [],
        targetedBy: [],
      },
    ]);
  });

  it("flags an entry step left with nothing, and the transitions that reach it through its purpose", () => {
    expect(flowOf(passkeyFirstFlow).methodUses("passkey", ["password"])[0]).toEqual({
      step: "passkey-first",
      uses: 'offers passkey (action "passkey")',
      keeps: [],
      entryFor: ["login"],
      targetedBy: [
        { step: "register", transition: "sign_in", purpose: "login" },
        { step: "sso-conflict", transition: "sign_in" },
      ],
    });
  });

  it("counts sso_providers and gates as what a step keeps", () => {
    const flow = {
      purposes: { login: "password" },
      steps: [
        {
          name: "password",
          fields: ["x-auth-methods#password"],
          sso_providers: ["google"],
          gates: { consent: {} },
        },
      ],
    };

    expect(flowOf(flow).methodUses("password", ["sso"])[0]?.keeps).toEqual([
      "sso_providers",
      "gates",
    ]);
  });

  it("does not count a transition into another flow as targeting a step", () => {
    const flow = {
      purposes: { login: "password" },
      steps: [
        { name: "start", transitions: { go: { target: "password", action: "switch" } } },
        { name: "password", fields: ["x-auth-methods#password"] },
      ],
    };

    expect(flowOf(flow).methodUses("password", [])[0]?.targetedBy).toEqual([]);
  });

  it("does not count what a method the schema no longer enables offers", () => {
    const flow = {
      purposes: { login: "password" },
      steps: [
        {
          name: "password",
          fields: ["x-auth-methods#password"],
          actions: [{ name: "passkey", kind: "passkey" }],
          sso_providers: ["google"],
        },
      ],
    };

    expect(flowOf(flow).methodUses("password", [])[0]?.keeps).toEqual([]);
  });

  it("lists every step that offers a passkey", () => {
    const uses = flowOf(passkeyFirstFlow)
      .methodUses("passkey", ["password"])
      .map((use) => {
        return [use.step, use.keeps];
      });

    expect(uses).toEqual([
      ["passkey-first", []],
      ["identifier", ['field "email"']],
      ["password", ['field "x-auth-methods#password"']],
    ]);
  });
});
