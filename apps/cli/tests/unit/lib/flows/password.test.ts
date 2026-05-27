import { describe, expect, it } from "vitest";

import { flowDefinitionSchema } from "../../../../src/lib/flows";
import { buildPasswordFlow } from "../../../../src/lib/flows/password";

describe("buildPasswordFlow", () => {
  it("emits a flow that round-trips through flowDefinitionSchema", () => {
    const flow = buildPasswordFlow(["email", "given_name"]);
    const parsed = flowDefinitionSchema.safeParse(flow);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("adds a password field and a forgot action on the credential step", () => {
    const flow = buildPasswordFlow(["email"]);
    const credential = flow.steps.find((step) => step.name === "credential");
    expect(credential?.fields.password?.type).toBe("password");
    expect(credential?.fields.password?.text_key).toBe("credential.field.password");
    expect(credential?.actions.forgot?.text_key).toBe("credential.action.forgot");
    expect(credential?.transitions).toMatchObject({
      submit: "complete",
      forgot: { pivot: "recovery" },
    });
  });

  it("returns a freshly allocated object on every call", () => {
    const a = buildPasswordFlow(["email"]);
    const b = buildPasswordFlow(["email"]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
