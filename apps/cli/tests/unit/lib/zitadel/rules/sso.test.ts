import { describe, expect, it } from "vitest";

import { type Issue, ZitadelConfig } from "@/lib/zitadel";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";

const SCHEMA = ".zitadel/schemas/staff.json";
const FLOW = ".zitadel/flows/login.json";
const CONNECTION = ".zitadel/idps/acme.json";

type Entry = Readonly<{ path: string; body: Record<string, unknown> }>;

function schema(providers: string[], over: Record<string, unknown> = {}): Entry {
  return {
    path: SCHEMA,
    body: {
      objectType: "staff",
      properties: { email: {} },
      "x-auth-methods": { sso: { enabled: true, providers } },
      ...over,
    },
  };
}

function flow(userSchema: string, providers: string[]): Entry {
  return {
    path: FLOW,
    body: {
      user_schema: userSchema,
      steps: [
        {
          name: "identifier",
          sso_providers: providers,
          transitions: {
            sso_authenticated: { target: "done" },
            sso_user_not_found: { target: "register-sso" },
            user_already_exists: { target: "sso-conflict" },
          },
        },
      ],
    },
  };
}

function connection(slug: string, path = CONNECTION): Entry {
  return { path, body: { slug, claim_mapping: { email: "email" } } };
}

function issuesOf(input: {
  schemas?: readonly Entry[];
  flows?: readonly Entry[];
  connections?: readonly Entry[];
}): readonly Issue[] {
  const config = ZitadelConfig.of({
    schemas: input.schemas ?? [],
    flows: input.flows ?? [],
    connections: input.connections ?? [],
    policies: [],
    branding: [],
  });
  return SSO_RULES.flatMap((rule) => {
    return rule.check(config, {});
  });
}

describe("SSO_RULES", () => {
  it("find nothing in a project whose files agree", () => {
    const issues = issuesOf({
      schemas: [schema(["acme"])],
      flows: [flow("staff", ["acme"])],
      connections: [connection("acme")],
    });

    expect(issues).toEqual([]);
  });

  it("find nothing in a project with no SSO files at all", () => {
    expect(issuesOf({})).toEqual([]);
  });

  it("refuse a provider the pinned schema does not list, naming the flow file and its step", () => {
    const issues = issuesOf({
      schemas: [schema(["other"])],
      flows: [flow("staff", ["acme"])],
      connections: [connection("acme")],
    });

    expect(issues).toContainEqual({
      severity: "error",
      rule: "sso/provider-id",
      file: FLOW,
      steps: ["identifier"],
      message: `step "identifier": sso provider "acme" is not listed in sso.providers of ${SCHEMA}. Add it there, or remove it from the flow.`,
    });
  });

  it("refuse a schema that lists a provider with no connection file, naming the schema", () => {
    const issues = issuesOf({ schemas: [schema(["acme"])] });

    expect(issues).toEqual([
      {
        severity: "error",
        rule: "sso/connection-resolves",
        file: SCHEMA,
        slug: "acme",
        message:
          'sso.providers lists "acme" but there is no connection file with that slug under .zitadel/idps/. Add the file, or remove "acme" from sso.providers.',
      },
    ]);
  });

  it("refuse a second connection file that claims a slug, naming the first", () => {
    const issues = issuesOf({
      connections: [connection("acme"), connection("acme", ".zitadel/idps/copy.json")],
    });

    expect(issues).toEqual([
      {
        severity: "error",
        rule: "sso/duplicate-slug",
        file: ".zitadel/idps/copy.json",
        message: `connection slug "acme" is also used by ${CONNECTION}. A slug names one connection: change the slug here, or delete one of the two files.`,
      },
    ]);
  });

  it("report every problem, one issue each", () => {
    const issues = issuesOf({ schemas: [schema(["acme", "ghost"])] });

    expect(
      issues.map((issue) => {
        return issue.slug;
      }),
    ).toEqual(["acme", "ghost"]);
  });

  describe("finding the schema a flow pins", () => {
    it("matches a flow's user_schema to a schema's objectType", () => {
      const issues = issuesOf({
        schemas: [schema(["other"])],
        flows: [flow("staff", ["acme"])],
        connections: [connection("acme")],
      });

      expect(
        issues.map((issue) => {
          return issue.rule;
        }),
      ).toContain("sso/provider-id");
    });

    it("matches a flow's user_schema to a schema's $id", () => {
      const id = "https://schemas.example.test/staff.json";
      const issues = issuesOf({
        schemas: [schema(["other"], { $id: id })],
        flows: [flow(id, ["acme"])],
        connections: [connection("acme")],
      });

      expect(
        issues.map((issue) => {
          return issue.rule;
        }),
      ).toContain("sso/provider-id");
    });

    it("does not hold a flow to a schema the project does not keep locally", () => {
      const issues = issuesOf({
        flows: [flow("not-kept-here", ["acme"])],
        connections: [connection("acme")],
      });

      expect(issues).toEqual([]);
    });
  });
});
