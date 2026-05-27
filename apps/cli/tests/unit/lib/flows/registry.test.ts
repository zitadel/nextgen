import { describe, expect, it } from "vitest";

import { AUTH_METHODS, buildFlowAndLocale } from "../../../../src/lib/flows";
import { passkey } from "../../../../src/lib/flows/passkey";
import { password } from "../../../../src/lib/flows/password";

describe("AUTH_METHODS", () => {
  it("lists exactly passkey and password, in that order", () => {
    expect([...AUTH_METHODS]).toEqual(["passkey", "password"]);
  });
});

describe("buildFlowAndLocale", () => {
  it("password dispatch returns the same result as calling password.build directly", () => {
    const args = { fields: ["email", "given_name"] };
    expect(buildFlowAndLocale("password", args)).toEqual(password.build(args));
  });

  it("passkey dispatch returns the same result as calling passkey.build directly", () => {
    const args = { fields: ["email"] };
    expect(buildFlowAndLocale("passkey", args)).toEqual(passkey.build(args));
  });

  it("returns freshly allocated objects, not the same reference across calls", () => {
    const a = buildFlowAndLocale("password", { fields: ["email"] });
    const b = buildFlowAndLocale("password", { fields: ["email"] });
    expect(a.flow).not.toBe(b.flow);
    expect(a.locale).not.toBe(b.locale);
  });
});
