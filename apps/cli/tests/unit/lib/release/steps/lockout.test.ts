import { ApiError } from "@zitadel/api/runtime/fetch";
import { beforeEach, describe, expect, it } from "vitest";

import type { StepContext } from "../../../../../src/lib/release/pipeline";
import { lockoutStep } from "../../../../../src/lib/release/steps/lockout";
import { takeReportedWarnings } from "../../../../../src/lib/warnings";

type FakeUser = {
  id: string;
  schema: string;
  type: string;
  attributes: Record<string, unknown>;
  status?: string;
};

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
  failListSchemas?: boolean;
  requested?: number[];
  failNotEquals?: boolean;
  endlessEmptyPages?: boolean;
  failFor?: string;
  failLinks?: boolean;
  selector?: string;
  missingLinks?: string[];
  listing?: Array<{
    id: string;
    schema: Record<string, unknown>;
    metadata?: { created_at: string };
  }>;
  listed?: number[];
}): StepContext {
  return {
    cwd: "/unused",
    client: {
      queryUsers: async (body: {
        filter: { field: string; operation: string; value: string }[];
        limit: number;
        page_token?: string;
      }) => {
        if (options.failQuery) {
          throw new Error("forbidden");
        }
        if (options.failNotEquals && body.filter.some((f) => f.operation === "not_equals")) {
          throw new Error("boom");
        }
        if (options.failFor && body.filter.some((f) => f.value === options.failFor)) {
          throw new Error("boom");
        }
        if (options.endlessEmptyPages) {
          return { users: [], next_page_token: "again" };
        }
        const equals = body.filter.find(
          (f) => f.field === "schema_object_type" && f.operation === "equals",
        )?.value;
        const status = body.filter.find((f) => f.field === "status")?.value;
        const excluded = body.filter
          .filter((f) => f.operation === "not_equals")
          .map((f) => f.value);
        const matching = options.users.filter(
          (user) =>
            (status === undefined || (user.status ?? "active") === status) &&
            (equals === undefined ? !excluded.includes(user.type) : user.type === equals),
        );
        const start = Number(body.page_token ?? 0);
        const users = matching.slice(start, start + body.limit);
        options.requested?.push(users.length);
        return {
          users,
          next_page_token:
            start + users.length < matching.length ? String(start + users.length) : null,
        };
      },
      listUserIdentityLinks: async (id: string) => {
        if (options.failLinks) {
          throw new Error("forbidden");
        }
        if (options.missingLinks?.includes(id)) {
          throw new ApiError(
            404,
            "http://localhost/users",
            { code: "user.not_found" },
            "Not Found",
          );
        }
        return {
          identity_links: Array.from({ length: options.links?.[id] ?? 0 }, () => ({})),
        };
      },
      listSchemas: {
        all: async () => {
          options.listed?.push(1);
          if (options.failListSchemas) {
            throw new Error("forbidden");
          }
          if (options.listing) {
            return options.listing;
          }
          return [
            { id: HUMAN, schema: { objectType: "human-user" } },
            { id: EMPLOYEE, schema: { objectType: "employee" } },
          ];
        },
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
    suggest: (args) => (options.selector ? `${args} ${options.selector}` : args) as never,
  };
}

const flowCollecting = (schema: string, fields: string[], status = "active") => ({
  name: "default-login",
  status,
  user_schema: schema,
  purposes: { login: "identifier" },
  steps: [
    { name: "identifier", fields, transitions: { submit: { target: "password" } } },
    { name: "password", fields: ["x-auth-methods#password"] },
  ],
});

const flow = (schema: string, identifier = "email", status = "active") =>
  flowCollecting(schema, [identifier], status);

/** The `passkey-first` preset's shape: the identifier step is reached through `email_fallback`. */
const passkeyFirstFlow = (schema: string) => ({
  name: "default-login",
  status: "active",
  user_schema: schema,
  purposes: { login: "passkey-first" },
  steps: [
    {
      name: "passkey-first",
      fields: [],
      transitions: { email_fallback: { target: "identifier" }, register: { purpose: "register" } },
    },
    { name: "identifier", fields: ["email"], transitions: { submit: { target: "password" } } },
    { name: "password", fields: ["x-auth-methods#password"] },
  ],
});

/** A login that collects no identifier itself and only switches to a sign-up that does. */
const signUpOnlyCollectsFlow = (schema: string) => ({
  name: "default-login",
  status: "active",
  user_schema: schema,
  purposes: { login: "start", register: "register" },
  steps: [
    { name: "start", fields: [], transitions: { register: { purpose: "register" } } },
    { name: "register", fields: ["email"] },
  ],
});
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
        flows: [flow("human-user", "username")],
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

  it("does not treat a login field the schema does not designate as a lookup", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flow("human-user", "username")],
        users: [user("u1", "human-user", { email: "a@example.com" })],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("checks only the designated identifier among the fields a login step collects", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flowCollecting("human-user", ["email", "nickname"])],
        users: [user("u1", "human-user", { email: "a@example.com" })],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("finds the identifier on a later step of the login path", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [passkeyFirstFlow("human-user")],
        users: [user("u1", "human-user", {})],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('has no "email"');
  });

  it("does not follow a purpose change off the login path", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [signUpOnlyCollectsFlow("human-user")],
        users: [user("u1", "human-user", {})],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("reads no more than the scan limit in all, across schemas", async () => {
    const requested: number[] = [];
    const many = (type: string) =>
      Array.from({ length: 700 }, (_, index) => user(`${type}-${index}`, type, {}));
    await lockoutStep.run(
      ctx({
        schemas: [
          { objectType: "human-user", "x-identifier": "email" },
          { objectType: "employee", "x-identifier": "email" },
        ],
        flows: [flow("human-user"), flow("employee")],
        users: [...many("human-user"), ...many("employee")],
        requested,
      }),
    );

    expect(requested.reduce((total, count) => total + count, 0)).toBeLessThanOrEqual(1000);
  });

  it("stays quiet when every user carries the identifier", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user" }],
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
        flows: [flow(EMPLOYEE, "username")],
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

  it("suggests the dot-path form for a dotted identifier", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "account.handle" }],
        flows: [flow("human-user", "account.handle")],
        users: [user("u1", "human-user", {})],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain("--set attributes.account.handle=<value>");
  });

  it("does not read an inherited property as the identifier", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "constructor" }],
        flows: [flow("human-user", "constructor")],
        users: [user("u1", "human-user", {})],
      }),
    );

    expect(takeReportedWarnings()).toHaveLength(1);
  });

  it("keeps the identifier warning when a link read fails", async () => {
    const c = ctx({
      schemas: [{ objectType: "human-user", "x-identifier": "username" }],
      flows: [flow("human-user", "username")],
      users: [user("u1", "human-user", {}), user("u2", "other")],
    });
    (c.client as unknown as { listUserIdentityLinks: unknown }).listUserIdentityLinks =
      async () => {
        throw new Error("404");
      };

    await lockoutStep.run(c);

    const warnings = takeReportedWarnings();
    expect(warnings[0]).toContain('has no "username"');
    expect(warnings.at(-1)).toContain("Could not finish checking existing users");
  });

  it("does not count a draft flow as serving its schema", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }, { objectType: "human-user" }],
        flows: [flow("employee"), flow("human-user", "email", "draft")],
        users: [user("u1", "human-user")],
        links: { u1: 1 },
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('of "human-user" has an SSO link');
  });

  it("does not guess which schema is unserved when a flow's schema cannot be resolved", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee"), flow("https://schemas.test/unknown.json")],
        users: [user("u1", "human-user")],
        links: { u1: 1 },
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Skipped the SSO lockout check");
  });

  it("still warns about missing identifiers when the schemas cannot be listed", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "username" }],
        flows: [flow("human-user", "username")],
        users: [user("u1", "human-user", { email: "a@example.com" })],
        failListSchemas: true,
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('has no "username"');
  });

  it("does not follow a not-found outcome into a sign-up step", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [
          {
            name: "default-login",
            status: "active",
            user_schema: "human-user",
            purposes: { login: "start" },
            steps: [
              {
                name: "start",
                fields: [],
                transitions: { sso_user_not_found: { target: "register-sso" } },
              },
              { name: "register-sso", fields: ["email"] },
            ],
          },
        ],
        users: [user("u1", "human-user", {})],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("gives every schema its own share of the scan limit", async () => {
    const lots = Array.from({ length: 1200 }, (_, index) =>
      user(`a-${index}`, "human-user", { email: "a@example.com" }),
    );
    await lockoutStep.run(
      ctx({
        schemas: [
          { objectType: "human-user", "x-identifier": "email" },
          { objectType: "employee", "x-identifier": "email" },
        ],
        flows: [flow("human-user"), flow("employee")],
        users: [
          ...lots,
          user("e1", "employee", {}),
          user("e2", "employee", {}),
          user("e3", "employee", {}),
        ],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain(
      '3 of 3 existing users of "employee" have no "email"',
    );
  });

  it("keeps one scan's warning when the other scan fails", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flow("human-user")],
        users: [user("u1", "human-user", {})],
        failNotEquals: true,
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('has no "email"');
  });

  it("stops asking when a page is empty but still offers another", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flow("human-user")],
        users: [],
        endlessEmptyPages: true,
      }),
    );

    expect(takeReportedWarnings()[0]).toContain("Checked only some of the users of");
  });

  it("says so when it only looked up the links of the first stranded users", async () => {
    const stranded = Array.from({ length: 250 }, (_, index) => user(`s-${index}`, "human-user"));
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: stranded,
        links: { "s-249": 1 },
      }),
    );

    expect(takeReportedWarnings()[0]).toContain(
      "Checked only some of the users of the schemas no flow serves",
    );
  });

  it("counts linked users among the first stranded ones", async () => {
    const stranded = Array.from({ length: 250 }, (_, index) => user(`s-${index}`, "human-user"));
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: stranded,
        links: { "s-0": 1 },
      }),
    );

    expect(takeReportedWarnings()[0]).toContain("at least 1 existing user");
  });

  it("reports an exact count when the read ends exactly at the limit", async () => {
    const exact = Array.from({ length: 500 }, (_, index) => user(`u-${index}`, "human-user", {}));
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flow("human-user")],
        users: exact,
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('500 of 500 existing users of "human-user"');
  });

  it("keeps one schema's warning when another schema's read fails", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [
          { objectType: "human-user", "x-identifier": "email" },
          { objectType: "employee", "x-identifier": "email" },
        ],
        flows: [flow("human-user"), flow("employee")],
        users: [user("u1", "human-user", {}), user("e1", "employee", {})],
        failFor: "employee",
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings[0]).toContain('of "human-user"');
    expect(warnings.at(-1)).toContain("Could not finish checking existing users");
  });

  it("does not list the schemas when every flow names an object type and nobody is linked", async () => {
    const listed: number[] = [];
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flow("human-user")],
        users: [user("u1", "human-user", { email: "a@example.com" })],
        listed,
      }),
    );

    expect(listed).toHaveLength(0);
  });

  it("lists the schemas once when both resolving a flow and naming a user need them", async () => {
    const listed: number[] = [];
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow(EMPLOYEE)],
        users: [user("u1", "human-user")],
        links: { u1: 1 },
        listed,
      }),
    );

    expect(listed).toHaveLength(1);
    expect(takeReportedWarnings()[0]).toContain('of "human-user" has an SSO link');
  });

  it("says the schemas could not be read, not that a flow's schema is undefined", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow(EMPLOYEE)],
        users: [],
        failListSchemas: true,
      }),
    );

    expect(takeReportedWarnings()[0]).toContain("the project's schemas could not be read");
  });

  it("reports failed identity-link reads instead of counting the users as unlinked", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: [user("u1", "human-user")],
        links: { u1: 1 },
        failLinks: true,
      }),
    );

    expect(takeReportedWarnings()).toEqual([
      expect.stringContaining("Could not finish checking existing users"),
    ]);
  });

  it("checks the identifier of a schema that is only in the project's listing", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [],
        flows: [flow(HUMAN)],
        users: [user("u1", "human-user", {})],
        listing: [{ id: HUMAN, schema: { objectType: "human-user", "x-identifier": "email" } }],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('has no "email"');
  });

  it("counts users together, without schema ids, when their schemas cannot be named", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: [user("u1", "human-user"), user("u2", "human-user")],
        links: { u1: 1, u2: 1 },
        failListSchemas: true,
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings[0]).toContain("2 existing users of schemas whose names could not be read");
    expect(warnings[0]).not.toContain(HUMAN);
  });

  it("counts only active users", async () => {
    const gone = Array.from({ length: 200 }, (_, index) => ({
      ...user(`d-${index}`, "human-user", {}),
      status: "deactivated",
    }));
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [flow("human-user")],
        users: [
          user("a1", "human-user", {}),
          user("a2", "human-user", {}),
          user("a3", "human-user", {}),
          ...gone,
        ],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('3 of 3 existing users of "human-user"');
  });

  it("does not report a user deleted since the query as a failure", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: [user("u1", "human-user"), user("u2", "human-user")],
        links: { u2: 1 },
        missingLinks: ["u1"],
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1 existing user of "human-user" has an SSO link');
  });

  it("says so when resolving the flows throws before the scans start", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [
          {
            name: "default-login",
            status: "active",
            user_schema: "human-user",
            purposes: { login: "identifier" },
            steps: [{ name: "identifier", fields: ["email"], transitions: { submit: null } }],
          },
        ],
        users: [],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain("Could not finish checking existing users");
  });

  it("names a schema that really has an empty object type instead of calling it unnamed", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee")],
        users: [user("u1", "human-user")],
        links: { u1: 1 },
        listing: [{ id: HUMAN, schema: { objectType: "" } }],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('of "" has an SSO link');
  });

  it("runs for deploy only", () => {
    expect(lockoutStep.runsFor).toEqual(["deploy"]);
  });

  it("checks a flow whose schema exists only on the server, named by object type", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [],
        flows: [flow("employee")],
        users: [user("e1", "employee", {})],
        listing: [{ id: EMPLOYEE, schema: { objectType: "employee", "x-identifier": "email" } }],
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('has no "email"');
  });

  it("uses the newest revision of a server-only schema for its identifier", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [],
        flows: [flow("employee", "email")],
        users: [user("e1", "employee", { email: "a@example.com" })],
        listing: [
          {
            id: "sch_new",
            schema: { objectType: "employee", "x-identifier": "email" },
            metadata: { created_at: "2026-02-01T00:00:00Z" },
          },
          {
            id: "sch_old",
            schema: { objectType: "employee", "x-identifier": "username" },
            metadata: { created_at: "2026-01-01T00:00:00Z" },
          },
        ],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("tells the reader to move each user to the revision that defines the identifier", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "username" }],
        flows: [flow("human-user", "username")],
        users: [user("u1", "human-user", { email: "a@example.com" })],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain(
      "users update <user_id> --schema <revision_id> --set attributes.username=<value>",
    );
  });

  it("builds the recovery command with the deployment's environment selector", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "username" }],
        flows: [flow("human-user", "username")],
        users: [user("u1", "human-user", { email: "a@example.com" })],
        selector: "--env production",
      }),
    );

    expect(takeReportedWarnings()[0]).toContain(
      "users update <user_id> --schema <revision_id> --set attributes.username=<value> --env production",
    );
  });

  it("takes the identifier from the newest revision when a flow names an older one by id", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [],
        flows: [flow("sch_old", "username")],
        users: [user("e1", "employee", { email: "a@example.com" })],
        listing: [
          {
            id: "sch_new",
            schema: { objectType: "employee", "x-identifier": "username" },
            metadata: { created_at: "2026-02-01T00:00:00Z" },
          },
          {
            id: "sch_old",
            schema: { objectType: "employee", "x-identifier": "email" },
            metadata: { created_at: "2026-01-01T00:00:00Z" },
          },
        ],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('has no "username"');
  });

  it("still checks SSO users when no active flow is left, without the passkey reassurance", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("employee", "email", "draft")],
        users: [user("u1", "human-user")],
        links: { u1: 1 },
      }),
    );

    const warnings = takeReportedWarnings();
    expect(warnings[0]).toContain('of "human-user" has an SSO link');
    expect(warnings[0]).not.toContain("Passkey sign-in is not affected");
  });

  it("follows a plain transition to a step that is also the sign-up entry", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "human-user", "x-identifier": "email" }],
        flows: [
          {
            name: "default-login",
            status: "active",
            user_schema: "human-user",
            purposes: { login: "start", register: "register" },
            steps: [
              { name: "start", fields: [], transitions: { go: { target: "register" } } },
              { name: "register", fields: ["email"] },
            ],
          },
        ],
        users: [user("u1", "human-user", {})],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('has no "email"');
  });

  it("lets the bundle's schema drop the designation even if a listed revision still has one", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [flow("sch_old", "email")],
        users: [user("e1", "employee", {})],
        listing: [
          {
            id: "sch_old",
            schema: { objectType: "employee", "x-identifier": "email" },
            metadata: { created_at: "2026-01-01T00:00:00Z" },
          },
        ],
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("does not warn about linked users when the release carries no flow definitions", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [{ objectType: "employee" }],
        flows: [],
        users: [user("u1", "human-user")],
        links: { u1: 1 },
      }),
    );

    expect(takeReportedWarnings()).toEqual([]);
  });

  it("takes the first listed revision, which the API lists newest first, whatever the timestamps' fractional digits", async () => {
    await lockoutStep.run(
      ctx({
        schemas: [],
        flows: [flow("employee", "username")],
        users: [user("e1", "employee", { email: "a@example.com" })],
        listing: [
          {
            id: "sch_new",
            schema: { objectType: "employee", "x-identifier": "username" },
            metadata: { created_at: "2026-01-01T00:00:00.123Z" },
          },
          {
            id: "sch_old",
            schema: { objectType: "employee", "x-identifier": "email" },
            metadata: { created_at: "2026-01-01T00:00:00.12Z" },
          },
        ],
      }),
    );

    expect(takeReportedWarnings()[0]).toContain('has no "username"');
  });

  it("never fails the deploy when users cannot be read", async () => {
    await expect(
      lockoutStep.run(
        ctx({
          schemas: [{ objectType: "human-user", "x-identifier": "username" }],
          flows: [flow("human-user", "username")],
          users: [],
          failQuery: true,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(takeReportedWarnings()[0]).toContain("Could not finish checking existing users");
  });
});
