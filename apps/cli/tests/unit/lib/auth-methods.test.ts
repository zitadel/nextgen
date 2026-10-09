import { describe, expect, it } from "vitest";

import {
  hasIdentifier,
  listedProviders,
  malformedAuthMethods,
  reachableSignInMethods,
  setMethodEnabled,
  usableSignInMethods,
} from "../../../src/lib/auth-methods";

const schema = (methods: unknown): Record<string, unknown> => ({
  type: "object",
  "x-identifier": "email",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
  "x-auth-methods": methods,
});

/** A flow whose login journey collects a password. */
const passwordFlow = {
  status: "active",
  purposes: { login: "password" },
  steps: [{ name: "password", fields: ["x-auth-methods#password"] }],
};

/** A flow whose login journey offers these providers. */
const ssoFlow = (providers: string[]) => ({
  status: "active",
  purposes: { login: "identifier" },
  steps: [{ name: "identifier", sso_providers: providers }],
});

describe("setMethodEnabled", () => {
  it("switches only the named method", () => {
    const before = schema({ password: { enabled: true }, passkey: { enabled: true } });

    const result = setMethodEnabled(before, "passkey", false);

    expect(result.changed).toBe(true);
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

    const result = setMethodEnabled(before, "passkey", true);

    expect(result.document["x-auth-methods"]).toEqual({
      passkey: { enabled: true },
      sso: { enabled: true, providers: ["google"] },
    });
  });

  it("adds a method the schema does not mention", () => {
    const result = setMethodEnabled(schema({ password: { enabled: true } }), "passkey", true);

    expect(result.document["x-auth-methods"]).toMatchObject({ passkey: { enabled: true } });
  });

  it("reports a method already in the requested state as unchanged and returns the input", () => {
    const before = schema({ password: { enabled: true } });

    const result = setMethodEnabled(before, "password", true);

    expect(result).toEqual({ document: before, changed: false });
  });

  it("does not mutate the schema it was given", () => {
    const before = schema({ password: { enabled: true } });
    const copy = structuredClone(before);

    setMethodEnabled(before, "password", false);

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

  it("does not count methods the login engine cannot serve", () => {
    expect(
      usableSignInMethods(schema({ otp: { enabled: true }, magic_link: { enabled: true } })),
    ).toEqual([]);
  });

  it("is empty for a schema without x-auth-methods", () => {
    expect(usableSignInMethods({ type: "object" })).toEqual([]);
  });
});

describe("listedProviders", () => {
  it("lists every provider as written, well-formed or not", () => {
    expect(
      listedProviders(schema({ sso: { enabled: true, providers: ["google", "Not A Slug", 7] } })),
    ).toEqual(["google", "Not A Slug"]);
  });

  it("is empty when the schema lists none", () => {
    expect(listedProviders(schema({ password: { enabled: true } }))).toEqual([]);
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

describe("malformedAuthMethods", () => {
  it("accepts an absent container or entry", () => {
    expect(malformedAuthMethods({ type: "object" }, "passkey")).toBeUndefined();
    expect(
      malformedAuthMethods(schema({ password: { enabled: true } }), "passkey"),
    ).toBeUndefined();
  });

  it("ignores a malformed entry of another method", () => {
    expect(malformedAuthMethods(schema({ password: true }), "passkey")).toBeUndefined();
  });

  it.each([
    ["x-auth-methods is not an object", []],
    ["x-auth-methods.passkey is not an object", { passkey: true }],
    ["x-auth-methods.passkey.enabled is not a boolean", { passkey: {} }],
    ["x-auth-methods.passkey.enabled is not a boolean", { passkey: { enabled: "true" } }],
  ])("names the region when %s", (region, methods) => {
    expect(malformedAuthMethods(schema(methods), "passkey")).toBe(region);
  });
});

describe("reachableSignInMethods", () => {
  it("counts only methods an active flow offers", () => {
    // The shipped default: passkey is enabled, but the flow offers password
    // only.
    const both = schema({ password: { enabled: true }, passkey: { enabled: true } });

    expect(reachableSignInMethods(both, [passwordFlow])).toEqual(["password"]);
  });

  it("is empty when the flow offers nothing the schema enables", () => {
    const passkeyOnly = schema({ password: { enabled: false }, passkey: { enabled: true } });

    expect(reachableSignInMethods(passkeyOnly, [passwordFlow])).toEqual([]);
  });

  it("does not count a flow that is not active", () => {
    const password = schema({ password: { enabled: true } });

    expect(reachableSignInMethods(password, [{ ...passwordFlow, status: "draft" }])).toEqual([]);
  });

  it("does not count SSO for a provider the schema does not enable", () => {
    const sso = schema({ sso: { enabled: true, providers: ["google"] } });

    expect(reachableSignInMethods(sso, [ssoFlow(["github"])])).toEqual([]);
  });

  it("counts SSO on a step that names a provider the schema enables", () => {
    const sso = schema({ sso: { enabled: true, providers: ["google"] } });

    expect(reachableSignInMethods(sso, [ssoFlow(["google"])])).toEqual(["sso"]);
  });
});
