import { beforeEach, describe, expect, it } from "vitest";

import type { StepContext } from "../../../../../src/lib/release/pipeline";
import { lockoutStep } from "../../../../../src/lib/release/steps/lockout";
import { takeReportedWarnings } from "../../../../../src/lib/warnings";

type FakeUser = { id: string; schema: string; type: string; attributes: Record<string, unknown> };

beforeEach(() => {
  takeReportedWarnings();
});

const HUMAN = "https://schemas.test/human-user.json";
const EMPLOYEE = "https://schemas.test/employee.json";

function ctx(options: {
  schemas: Record<string, unknown>[];
  flows: Record<string, unknown>[];
  users: FakeUser[];
  links?: Record<string, number>;
  failQuery?: boolean;
}): StepContext {
  return {
    cwd: "/unused",
    client: {
      queryUsers: async (body: { filter: { operation: string; value: string }[] }) => {
        if (options.failQuery) throw new Error("forbidden");
        const equals = body.filter.find((f) => f.operation === "equals")?.value;
        const excluded = body.filter
          .filter((f) => f.operation === "not_equals")
          .map((f) => f.value);
        return {
          users: options.users.filter((user) =>
            equals === undefined ? !excluded.includes(user.type) : user.type === equals,
          ),
        };
      },
      listUserIdentityLinks: async (id: string) => ({
        identity_links: Array.from({ length: options.links?.[id] ?? 0 }, () => ({})),
      }),
      listSchemas: {
        all: async () => [
          { id: HUMAN, schema: { objectType: "human-user" } },
          { id: EMPLOYEE, schema: { objectType: "employee" } },
        ],
      },
    } as never,
    projectId: "proj_1",
    env: {},
    mode: "deploy",
    dryRun: false,
    json: false,
    color: false,
    bundle: { schemas: options.schemas, flow_definitions: options.flows, idps: [] },
    brandingSources: [],
    idpFiles: [],
    policyFiles: [],
    suggest: (args) => args as never,
  };
}

const flow = (schema: string) => ({ name: "default-login", user_schema: schema });
const user = (id: string, type: string, attributes: Record<string, unknown> = {}): FakeUser => ({
  id,
  type,
  schema: type === "employee" ? EMPLOYEE : HUMAN,
  attributes,
});

describe("lockoutStep", () => {
  it("warns with the count when users lack the property the schema now signs in with", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "username" }],
        flows: [flow("human-user")],
        users: [
          user("u1", "human-user", { email: "a@example.com" }),
          user("u2", "human-user", { username: "b" }),
        ],
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1 of 2 existing users of "human-user" has no "username"');
  });

  it("stays quiet when every user carries the identifier", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flow("human-user")],
        users: [user("u1", "human-user", { email: "a@example.com" })],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("warns when users of a schema no flow serves have an SSO link", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: [user("u1", "human-user"), user("u2", "human-user")],
        links: { u1: 1 },
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1 existing user of "human-user" has an SSO link');
    expect(warnings[0]).toContain('keep or restore a flow on "human-user"');
  });

  it("resolves a flow's schema given by its $id before checking either case", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee", $id: EMPLOYEE, "x-identifier": "username" }],
        flows: [flow(EMPLOYEE)],
        users: [user("u1", "employee", { email: "a@example.com" }), user("u2", "human-user")],
        links: { u2: 1, u1: 1 },
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('of "employee"');
    expect(warnings[1]).toContain('of "human-user"');
  });

  it("counts the revisions of one schema together", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: [user("u1", "human-user"), user("u2", "human-user")],
        links: { u1: 1, u2: 1 },
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2 existing users of "human-user" have an SSO link');
  });

  it("does not warn about users of the old schema who have no SSO link", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: [user("u1", "human-user")],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("never fails the deploy when users cannot be read", async () => {
    await expect(
      lockoutStep.run(
        ctx({
          schemas: [{ objectType: "human-user", "x-identifier": "username" }],
          flows: [flow("human-user")],
          users: [],
          failQuery: true,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(takeReportedWarnings()).toEqual([]);
  });
});
