import { describe, expect, it } from "vitest";

import { CreateFlowDefinitionBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

import { buildFlow } from "../../../../src/lib/flows";

const flowDefinitionSchema = CreateFlowDefinitionBody.shape.flow_definition;

describe("buildFlow", () => {
  it("emits a flow that round-trips through the generated zod", () => {
    const flow = buildFlow(["email", "given_name"]);
    const parsed = flowDefinitionSchema.safeParse(flow);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("routes the engine-emitted user_not_found outcome from identifier to register", () => {
    const flow = buildFlow(["email"]);
    const identifier = flow.steps.find((step: { name: string }) => step.name === "identifier");
    expect(identifier?.transitions?.user_not_found).toEqual({ target: "register-profile" });
  });

  it("references the password property on the credential step", () => {
    const flow = buildFlow(["email"]);
    const credential = flow.steps.find((step: { name: string }) => step.name === "credential");
    expect(credential?.fields).toEqual(["password"]);
  });

  it("collects both identifier and password on the register-profile step so create_user can run", () => {
    const flow = buildFlow(["email", "given_name"]);
    const register = flow.steps.find((step: { name: string }) => step.name === "register-profile");
    expect(register?.on_success).toBe("create_user");
    // create_user requires both an identifier and a password field on
    // the same step.
    expect(register?.fields).toEqual(["email", "given_name", "password"]);
  });

  it("emits a terminal complete: redirect step", () => {
    const flow = buildFlow(["email"]);
    const complete = flow.steps.find((step: { name: string }) => step.name === "complete");
    expect(complete?.complete).toBe("redirect");
  });

  it("returns a freshly allocated object on every call", () => {
    const a = buildFlow(["email"]);
    const b = buildFlow(["email"]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
