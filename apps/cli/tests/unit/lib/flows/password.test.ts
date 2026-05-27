import { describe, expect, it } from "vitest";

import { flowDefinitionSchema } from "../../../../src/lib/flows";
import { buildPasswordFlow } from "../../../../src/lib/flows/password";

describe("buildPasswordFlow", () => {
  it("emits a flow that round-trips through flowDefinitionSchema", () => {
    const { flow } = buildPasswordFlow(["email", "given_name"]);
    const parsed = flowDefinitionSchema.safeParse(flow);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("adds a password field and a forgot action on the credential step", () => {
    const { flow } = buildPasswordFlow(["email"]);
    const credential = flow.steps.find((step) => step.name === "credential");
    expect(credential?.fields.password?.type).toBe("password");
    expect(credential?.fields.password?.text_key).toBe("credential.field.password");
    expect(credential?.actions.forgot?.text_key).toBe("credential.action.forgot");
    expect(credential?.transitions).toMatchObject({
      submit: "complete",
      forgot: { pivot: "recovery" },
    });
  });

  it("seeds credential.field.password and credential.action.forgot in the locale", () => {
    const { locale } = buildPasswordFlow([]);
    expect(locale["credential.field.password"]).toBe("Password");
    expect(locale["credential.action.forgot"]).toBe("Forgot password?");
  });

  it("includes register-step locale entries for the requested fields", () => {
    const { locale } = buildPasswordFlow(["email", "given_name"]);
    expect(locale["register_profile.field.email"]).toBe("Email address");
    expect(locale["register_profile.field.given_name"]).toBe("First name");
  });

  it("returns freshly allocated objects on every call", () => {
    const a = buildPasswordFlow(["email"]);
    const b = buildPasswordFlow(["email"]);
    expect(a.flow).not.toBe(b.flow);
    expect(a.locale).not.toBe(b.locale);
    expect(a.flow).toEqual(b.flow);
    expect(a.locale).toEqual(b.locale);
  });
});
