import { describe, expect, it } from "vitest";

import { Branding, Flow, Policy, PolicyTest, UserSchema, ZitadelConfig } from "@/lib/zitadel";

const POLICY = ".zitadel/policies/password.json";
const POLICY_TEST = ".zitadel/policies/password.test.json";

/**
 * A configuration holding the password policy and its test file.
 *
 * @returns The configuration.
 */
function withPolicyAndTest(): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [],
    flows: [],
    connections: [],
    policies: [
      { path: POLICY, body: { operation: "password" } },
      { path: POLICY_TEST, body: { operation: "password", cases: [] } },
    ],
    branding: [],
  });
}

/**
 * The paths of a list of documents.
 *
 * @param documents - The documents.
 * @returns Their paths, in order.
 */
function pathsOf(documents: readonly { path: string }[]): readonly string[] {
  return documents.map((document) => {
    return document.path;
  });
}

describe("ZitadelConfig.with", () => {
  it.each([
    ["schema", UserSchema.create({ path: ".zitadel/schemas/user.json", body: {} }), "schemas"],
    ["flow", Flow.create({ path: ".zitadel/flows/login.json", body: {} }), "flows"],
    ["policy", Policy.create({ path: ".zitadel/policies/lockout.json", body: {} }), "policies"],
    ["branding", Branding.create({ path: ".zitadel/branding/login.json", body: {} }), "branding"],
  ] as const)("places a %s in its own collection", (_kind, document, collection) => {
    const config = ZitadelConfig.empty().with(document);

    expect(pathsOf(config[collection].all)).toEqual([document.path]);
  });

  it("places a policy test file among the policies' tests", () => {
    const test = PolicyTest.create({ path: ".zitadel/policies/lockout.test.json", body: {} });

    expect(pathsOf(ZitadelConfig.empty().with(test).policies.tests)).toEqual([test.path]);
  });

  it("replaces a policy test file at the same path, where it was", () => {
    const test = PolicyTest.create({ path: POLICY_TEST, body: { operation: "password" } });

    expect(withPolicyAndTest().with(test).policies.tests).toEqual([test]);
  });

  it("leaves the policies alone when a policy test file is placed", () => {
    const test = PolicyTest.create({ path: POLICY_TEST, body: { operation: "password" } });

    expect(pathsOf(withPolicyAndTest().with(test).policies.all)).toEqual([POLICY]);
  });
});

describe("ZitadelConfig.without", () => {
  it("removes a policy test file", () => {
    const config = withPolicyAndTest();
    const [test] = config.policies.tests;

    expect(test === undefined ? [] : config.without(test).policies.tests).toEqual([]);
  });

  it("deletes the removed policy test file's file", () => {
    const config = withPolicyAndTest();
    const [test] = config.policies.tests;

    expect(test === undefined ? [] : pathsOf(config.without(test).removedDocuments)).toEqual([
      POLICY_TEST,
    ]);
  });
});

describe("ZitadelConfig.changedDocuments", () => {
  it("includes a new policy test file", () => {
    const test = PolicyTest.create({ path: ".zitadel/policies/lockout.test.json", body: {} });

    expect(pathsOf(ZitadelConfig.empty().with(test).changedDocuments)).toEqual([test.path]);
  });

  it("leaves out the documents as read", () => {
    expect(withPolicyAndTest().changedDocuments).toEqual([]);
  });
});
