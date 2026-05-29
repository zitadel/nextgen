import { describe, expect, it } from "vitest";

import { AUTH_METHODS, buildFlow, isAuthMethod } from "../../../../src/lib/flows";
import { buildPasskeyFlow, buildPasswordFlow } from "../../../../src/lib/flows/methods";

describe("AUTH_METHODS", () => {
  it("lists exactly passkey and password, in that order", () => {
    expect([...AUTH_METHODS]).toEqual(["passkey", "password"]);
  });
});

describe("isAuthMethod", () => {
  it("accepts the supported methods", () => {
    expect(isAuthMethod("passkey")).toBe(true);
    expect(isAuthMethod("password")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isAuthMethod("magic-link")).toBe(false);
    expect(isAuthMethod("")).toBe(false);
    expect(isAuthMethod(undefined)).toBe(false);
    expect(isAuthMethod(123)).toBe(false);
  });
});

describe("buildFlow", () => {
  it("password dispatch matches calling buildPasswordFlow directly", () => {
    const fields = ["email", "given_name"];
    expect(buildFlow("password", fields)).toEqual(buildPasswordFlow(fields));
  });

  it("passkey dispatch matches calling buildPasskeyFlow directly", () => {
    const fields = ["email"];
    expect(buildFlow("passkey", fields)).toEqual(buildPasskeyFlow(fields));
  });

  it("returns a freshly allocated object on every call", () => {
    const a = buildFlow("password", ["email"]);
    const b = buildFlow("password", ["email"]);
    expect(a).not.toBe(b);
  });
});
