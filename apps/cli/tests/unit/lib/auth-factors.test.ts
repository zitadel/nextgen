import { describe, expect, it } from "vitest";

import {
  checkFlow,
  flowOffers,
  hasIdentifier,
  reachableSignInMethods,
  setAuthFactors,
  usableSignInMethods,
} from "../../../src/lib/auth-factors";

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

describe("setAuthFactors", () => {
  it("switches only the named factor", () => {
    const before = schema({ password: { enabled: true }, passkey: { enabled: true } });

    const result = setAuthFactors(before, ["passkey"], false);

    expect(result.changed).toEqual(["passkey"]);
    expect(result.document["x-auth-methods"]).toEqual({
      password: { enabled: true },
      passkey: { enabled: false },
    });
  });

  it("keeps the other methods as they are", () => {
    const before = schema({
      passkey: { enabled: false },
      sso: { enabled: true, providers: ["google"] },
    });

    const result = setAuthFactors(before, ["passkey"], true);

    expect(result.document["x-auth-methods"]).toEqual({
      passkey: { enabled: true },
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("adds a factor the schema does not mention", () => {
    const result = setAuthFactors(schema({ password: { enabled: true } }), ["passkey"], true);

    expect(result.document["x-auth-methods"]).toMatchObject({ passkey: { enabled: true } });
  });

  it("reports a factor already in the requested state as unchanged and returns the input", () => {
    const before = schema({ password: { enabled: true } });

    const result = setAuthFactors(before, ["password"], true);

    expect(result).toEqual({ document: before, changed: [], unchanged: ["password"] });
  });

  it("does not mutate the schema it was given", () => {
    const before = schema({ password: { enabled: true } });
    const copy = structuredClone(before);

    setAuthFactors(before, ["password"], false);

    expect(before).toEqual(copy);
  });
});

describe("usableSignInMethods", () => {
  it("counts SSO with a provider as a way in", () => {
    const methods = usableSignInMethods(
      schema({ password: { enabled: false }, sso: { enabled: true, providers: ["google"] } }),
    );

    expect(methods).toEqual(["sso"]);
  });

  it("does not count SSO whose providers are not valid slugs", () => {
    expect(
      usableSignInMethods(schema({ sso: { enabled: true, providers: [7, "Not A Slug", ""] } })),
    ).toEqual([]);
  });

  it("does not count SSO without a provider", () => {
    expect(usableSignInMethods(schema({ sso: { enabled: true, providers: [] } }))).toEqual([]);
  });

  it("does not count factors the login engine cannot serve", () => {
    expect(
      usableSignInMethods(schema({ otp: { enabled: true }, magic_link: { enabled: true } })),
    ).toEqual([]);
  });

  it("is empty for a schema without x-auth-methods", () => {
    expect(usableSignInMethods({ type: "object" })).toEqual([]);
  });
});

describe("hasIdentifier", () => {
  it("is true for a named property", () => {
    expect(hasIdentifier(schema({}))).toBe(true);
  });

  it("is false when absent or blank", () => {
    expect(hasIdentifier({ type: "object" })).toBe(false);
    expect(hasIdentifier({ "x-identifier": " " })).toBe(false);
  });
});

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

  it("finds nothing when the flow never used the factor", () => {
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

describe("reachableSignInMethods", () => {
  it("counts only methods an active flow offers", () => {
    // The shipped default: passkey is enabled, but the flow offers password only.
    const both = schema({ password: { enabled: true }, passkey: { enabled: true } });

    expect(reachableSignInMethods(both, [passwordFlow])).toEqual(["password"]);
  });

  it("is empty when the flow offers nothing the schema enables", () => {
    const passkeyOnly = schema({ password: { enabled: false }, passkey: { enabled: true } });

    expect(reachableSignInMethods(passkeyOnly, [passwordFlow])).toEqual([]);
  });

  it("does not count a register-only flow that collects a password", () => {
    const registerOnly = {
      purposes: { register: "register" },
      steps: [{ name: "register", fields: ["email", "x-auth-methods#password"] }],
    };

    expect(reachableSignInMethods(schema({ password: { enabled: true } }), [registerOnly])).toEqual(
      [],
    );
  });

  it("does not count register steps of a flow that also signs in", () => {
    // The login journey offers passkey only; password is collected on the
    // register side, which the login steps hand over to with a purpose flip.
    const combined = {
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
    const both = schema({ password: { enabled: true }, passkey: { enabled: true } });

    expect(reachableSignInMethods(both, [combined])).toEqual(["passkey"]);
  });

  it("does not count a flow that only registers passkeys", () => {
    const passkeyOnly = schema({ password: { enabled: false }, passkey: { enabled: true } });
    const registerOnly = {
      steps: [{ name: "register", actions: [{ name: "enrol", kind: "passkey_register" }] }],
    };

    expect(reachableSignInMethods(passkeyOnly, [registerOnly])).toEqual([]);
  });

  it("does not count SSO for a provider the schema does not enable", () => {
    const sso = schema({ sso: { enabled: true, providers: ["google"] } });
    const githubFlow = {
      purposes: { login: "identifier" },
      steps: [{ name: "identifier", sso_providers: ["github"] }],
    };

    expect(reachableSignInMethods(sso, [githubFlow])).toEqual([]);
  });

  it("counts SSO on a step that names a provider", () => {
    const sso = schema({ sso: { enabled: true, providers: ["google"] } });
    const ssoFlow = {
      purposes: { login: "identifier" },
      steps: [{ name: "identifier", sso_providers: ["google"] }],
    };

    expect(reachableSignInMethods(sso, [ssoFlow])).toEqual(["sso"]);
  });
});
