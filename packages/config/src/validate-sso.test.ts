import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type SsoConfigurationTree, validateSsoConfiguration } from "./validate-sso.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/sso-validation");

type Fixture = {
  rule: string;
  description: string;
  tree: {
    schemas: Record<string, object>;
    flows: Record<string, { body: object; schemaPath?: string }>;
    connections: Record<string, object>;
  };
  expect: Array<{ rule: string; file: string; step?: string; includes: string[] }>;
};

const asTree = (tree: Fixture["tree"]): SsoConfigurationTree => ({
  schemas: new Map(Object.entries(tree.schemas)),
  flows: new Map(Object.entries(tree.flows)),
  connections: new Map(Object.entries(tree.connections)),
});

/**
 * Each rule has a pair: a tree that breaks it and the same tree with the one
 * defect fixed. The files are the contract the server mirror (#1014) replays
 * to prove it reaches the same verdicts.
 */
describe("the fixture pairs", () => {
  const files = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

  it("has a failing and a passing tree for every rule", () => {
    const rules = new Set(files.map((name) => name.split(".")[0]));
    for (const rule of rules) {
      expect(files, rule).toContain(`${rule}.fail.json`);
      expect(files, rule).toContain(`${rule}.pass.json`);
    }
    expect([...rules].sort()).toEqual([
      "collection-conflict-routing",
      "connection-resolves",
      "empty-claim-mapping",
      "flow-enables-sso",
      "orphaned-mapping-target",
      "orphaned-verification-key",
      "outcome-routing",
      "provider-id",
      "unmapped-verification-key",
    ]);
  });

  for (const name of files) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Fixture;

    it(`${name}: ${fixture.description}`, () => {
      const issues = validateSsoConfiguration(asTree(fixture.tree));

      expect(
        issues.map(({ rule, file, step }) => ({ rule, file, ...(step ? { step } : {}) })),
      ).toEqual(
        fixture.expect.map(({ rule, file, step }) => ({ rule, file, ...(step ? { step } : {}) })),
      );
      issues.forEach((issue, index) => {
        for (const fragment of fixture.expect[index]?.includes ?? []) {
          expect(issue.message, `${name} #${index}`).toContain(fragment);
        }
      });
    });
  }
});

describe("what the rules look at", () => {
  const schema = (providers: string[], properties: object = { email: {} }) => ({
    properties,
    "x-auth-methods": { sso: { enabled: true, providers } },
  });
  const connection = (slug: string, mapping: object, verified?: object) => ({
    slug,
    claim_mapping: mapping,
    ...(verified ? { verified_claims: verified } : {}),
  });
  const tree = (over: Partial<SsoConfigurationTree>): SsoConfigurationTree => ({
    schemas: new Map(),
    flows: new Map(),
    connections: new Map(),
    ...over,
  });

  it("accepts a mapping target that is a nested property", () => {
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([
          ["s.json", schema(["acme"], { address: { properties: { street: {} } } })],
        ]),
        connections: new Map([["acme.json", connection("acme", { "address.street": "street" })]]),
      }),
    );

    expect(issues).toEqual([]);
  });

  it("judges a mapping target against the schemas that list the connection, not all of them", () => {
    // `contactEmail` exists, but only in a schema that does not list `acme`.
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([
          ["staff.json", schema(["acme"], { email: {} })],
          ["partners.json", schema([], { contactEmail: {} })],
        ]),
        connections: new Map([
          ["acme.json", connection("acme", { email: "email", contactEmail: "mail" })],
        ]),
      }),
    );

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/orphaned-mapping-target"]);
  });

  it("accepts a target that only one of several referencing schemas defines", () => {
    // Each schema consumes only the attributes it defines.
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([
          ["staff.json", schema(["acme"], { email: {}, staffNumber: {} })],
          ["partners.json", schema(["acme"], { email: {} })],
        ]),
        connections: new Map([
          ["acme.json", connection("acme", { email: "email", staffNumber: "employee_id" })],
        ]),
      }),
    );

    expect(issues).toEqual([]);
  });

  it("leaves a connection nothing refers to alone", () => {
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([["s.json", schema([])]]),
        connections: new Map([["acme.json", connection("acme", { typo: "x" }, { other: "y" })]]),
      }),
    );

    expect(issues).toEqual([]);
  });

  it("still checks a flow's routing when its schema could not be found", () => {
    const issues = validateSsoConfiguration(
      tree({
        flows: new Map([
          [
            "login.json",
            {
              body: {
                steps: [{ name: "identifier", sso_providers: ["acme"], transitions: {} }],
              },
            },
          ],
        ]),
        connections: new Map([["acme.json", connection("acme", { email: "email" })]]),
      }),
    );

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
    expect(issues[0]?.message).toContain(
      "sso_authenticated, sso_user_not_found, user_already_exists",
    );
  });

  it("collects every issue instead of stopping at the first", () => {
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([["s.json", schema(["a", "b"])]]),
      }),
    );

    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining('"a"'),
      expect.stringContaining('"b"'),
    ]);
  });
});
