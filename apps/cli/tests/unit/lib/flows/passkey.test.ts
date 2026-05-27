import { describe, expect, it } from "vitest";

import { flowDefinitionSchema } from "../../../../src/lib/flows";
import { buildPasskeyFlow } from "../../../../src/lib/flows/passkey";

describe("buildPasskeyFlow", () => {
  it("emits a flow that round-trips through flowDefinitionSchema", () => {
    const { flow } = buildPasskeyFlow(["email", "given_name"]);
    const parsed = flowDefinitionSchema.safeParse(flow);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("emits a credential step with no fields and no forgot action", () => {
    const { flow } = buildPasskeyFlow(["email"]);
    const credential = flow.steps.find((step) => step.name === "credential");
    expect(credential?.fields).toEqual({});
    expect(credential?.actions.forgot).toBeUndefined();
    expect(credential?.actions.submit?.primary).toBe(true);
    expect(credential?.transitions).toEqual({ submit: "complete" });
  });

  it("does not seed credential.field.password or credential.action.forgot", () => {
    const { locale } = buildPasskeyFlow([]);
    expect(locale).not.toHaveProperty("credential.field.password");
    expect(locale).not.toHaveProperty("credential.action.forgot");
  });

  it("includes register-step locale entries for the requested fields", () => {
    const { locale } = buildPasskeyFlow(["email", "given_name"]);
    expect(locale["register_profile.field.email"]).toBe("Email address");
    expect(locale["register_profile.field.given_name"]).toBe("First name");
  });

  it("returns freshly allocated objects on every call", () => {
    const a = buildPasskeyFlow(["email"]);
    const b = buildPasskeyFlow(["email"]);
    expect(a.flow).not.toBe(b.flow);
    expect(a.locale).not.toBe(b.locale);
    expect(a.flow).toEqual(b.flow);
    expect(a.locale).toEqual(b.locale);
  });
});
