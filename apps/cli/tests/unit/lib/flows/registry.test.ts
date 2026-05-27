import { describe, expect, it } from "vitest";

import { AUTH_METHODS, buildFlowAndLocale } from "../../../../src/lib/flows";
import { buildPasskeyFlow } from "../../../../src/lib/flows/passkey";
import { buildPasswordFlow } from "../../../../src/lib/flows/password";

describe("AUTH_METHODS", () => {
  it("lists exactly passkey and password, in that order", () => {
    expect([...AUTH_METHODS]).toEqual(["passkey", "password"]);
  });
});

describe("buildFlowAndLocale", () => {
  it("password dispatch matches calling buildPasswordFlow directly", () => {
    const fields = ["email", "given_name"];
    expect(buildFlowAndLocale("password", fields)).toEqual(buildPasswordFlow(fields));
  });

  it("passkey dispatch matches calling buildPasskeyFlow directly", () => {
    const fields = ["email"];
    expect(buildFlowAndLocale("passkey", fields)).toEqual(buildPasskeyFlow(fields));
  });

  it("returns freshly allocated objects, not the same reference across calls", () => {
    const a = buildFlowAndLocale("password", ["email"]);
    const b = buildFlowAndLocale("password", ["email"]);
    expect(a.flow).not.toBe(b.flow);
    expect(a.locale).not.toBe(b.locale);
  });
});
