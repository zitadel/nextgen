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
  expect: Array<{ rule: string; file: string; steps?: string[]; includes: string[] }>;
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

  /** A verdict as a replay compares it: what, where and on which steps, in no particular order. */
  const verdict = (issue: { rule: string; file: string; steps?: readonly string[] }) =>
    JSON.stringify([issue.rule, issue.file, issue.steps ?? []]);

  for (const name of files) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Fixture;

    it(`${name}: ${fixture.description}`, () => {
      const issues = validateSsoConfiguration(asTree(fixture.tree));

      expect(issues.map(verdict).sort()).toEqual(fixture.expect.map(verdict).sort());
      for (const expected of fixture.expect) {
        const found = issues.find((issue) => verdict(issue) === verdict(expected));
        for (const fragment of expected.includes) {
          expect(found?.message, `${name}`).toContain(fragment);
        }
      }
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

  it("reports one cause once, however many steps it is made on", () => {
    const step = (name: string) => ({
      name,
      sso_providers: ["acme"],
      transitions: {
        sso_authenticated: { target: "done" },
        sso_user_not_found: { target: "done" },
        user_already_exists: { target: "done" },
      },
    });
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([["s.json", schema(["other"])]]),
        flows: new Map([
          [
            "login.json",
            {
              schemaPath: "s.json",
              body: { steps: [step("identifier"), step("register"), step("sso-conflict")] },
            },
          ],
        ]),
        connections: new Map([
          ["acme.json", connection("acme", { email: "email" })],
          ["other.json", connection("other", { email: "email" })],
        ]),
      }),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.steps).toEqual(["identifier", "register", "sso-conflict"]);
    expect(issues[0]?.message).toContain('steps "identifier", "register", "sso-conflict"');
  });

  describe("a provider that only signs people in", () => {
    const disabled = { slug: "acme", provisioning: { creation: "disabled" }, claim_mapping: {} };
    const signInOnly = (routes: string[]) =>
      tree({
        schemas: new Map([["s.json", schema(["acme"])]]),
        flows: new Map([
          [
            "login.json",
            {
              schemaPath: "s.json",
              body: {
                steps: [
                  {
                    name: "identifier",
                    sso_providers: ["acme"],
                    transitions: Object.fromEntries(routes.map((r) => [r, { target: "done" }])),
                  },
                ],
              },
            },
          ],
        ]),
        connections: new Map([["acme.json", disabled]]),
      });

    it("needs only sso_authenticated, and no mapping", () => {
      expect(validateSsoConfiguration(signInOnly(["sso_authenticated"]))).toEqual([]);
    });

    it("still needs sso_authenticated", () => {
      expect(validateSsoConfiguration(signInOnly([])).map((issue) => issue.rule)).toEqual([
        "sso/outcome-routing",
      ]);
    });

    it("needs the register routes again as soon as another provider on the step creates users", () => {
      const mixed = signInOnly(["sso_authenticated"]);
      const created = new Map(mixed.connections);
      created.set("other.json", connection("other", { email: "email" }));
      const flows = new Map([
        [
          "login.json",
          {
            schemaPath: "s.json",
            body: {
              steps: [
                {
                  name: "identifier",
                  sso_providers: ["acme", "other"],
                  transitions: { sso_authenticated: { target: "done" } },
                },
              ],
            },
          },
        ],
      ]);

      const issues = validateSsoConfiguration({
        ...mixed,
        connections: created,
        flows,
        schemas: new Map([["s.json", schema(["acme", "other"])]]),
      });

      expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
    });
  });

  it("judges a connection a flow offers even when no schema lists it", () => {
    // `provider-id` reports the missing listing; the connection's own mistakes
    // still show, because it is in use.
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([["s.json", schema([])]]),
        flows: new Map([
          [
            "login.json",
            {
              schemaPath: "s.json",
              body: {
                steps: [
                  {
                    name: "identifier",
                    sso_providers: ["acme"],
                    transitions: {
                      sso_authenticated: { target: "done" },
                      sso_user_not_found: { target: "done" },
                      user_already_exists: { target: "done" },
                    },
                  },
                ],
              },
            },
          ],
        ]),
        connections: new Map([
          ["acme.json", connection("acme", { email: "email" }, { other: "x" })],
        ]),
      }),
    );

    expect(issues.map((issue) => issue.rule)).toContain("sso/unmapped-verification-key");
  });

  it("reads a connection by its slug, and the first file in path order stands for a duplicate", () => {
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([["s.json", schema(["acme"])]]),
        connections: new Map([
          ["b.json", connection("acme", { email: "email" })],
          ["a.json", connection("acme", { typo: "x" })],
        ]),
      }),
    );

    expect(issues).toEqual([
      expect.objectContaining({ rule: "sso/orphaned-mapping-target", file: "a.json" }),
    ]);
  });

  it("does not report a provider missing from sso.providers when sso is off", () => {
    // `flow-enables-sso` already says it; a second error would be noise.
    const issues = validateSsoConfiguration(
      tree({
        schemas: new Map([
          [
            "s.json",
            {
              properties: { email: {} },
              "x-auth-methods": { sso: { enabled: false, providers: [] } },
            },
          ],
        ]),
        flows: new Map([
          [
            "login.json",
            {
              schemaPath: "s.json",
              body: {
                steps: [
                  {
                    name: "identifier",
                    sso_providers: ["acme"],
                    transitions: {
                      sso_authenticated: { target: "done" },
                      sso_user_not_found: { target: "done" },
                      user_already_exists: { target: "done" },
                    },
                  },
                ],
              },
            },
          ],
        ]),
        connections: new Map([["acme.json", connection("acme", { email: "email" })]]),
      }),
    );

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/flow-enables-sso"]);
  });
});
