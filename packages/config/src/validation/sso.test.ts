import { describe, expect, it } from "vitest";

import {
  VALIDATION_RULES,
  validateProject,
  type ProjectTree,
  type ProjectRuleId,
} from "./index.js";

/**
 * A project is a plain object so a test can say what is different about it:
 * start from one that is valid, change one thing, and read what comes back.
 */
type Step = {
  name: string;
  fields: string[];
  sso_providers?: string[];
  on_success?: string;
  transitions: Record<string, { target: string }>;
};
type Schema = {
  properties: Record<string, object>;
  "x-auth-methods": { sso: { enabled: boolean; providers: string[] } };
};
type Connection = {
  slug: string;
  claim_mapping?: Record<string, string>;
  verified_claims?: Record<string, string>;
  provisioning?: { creation: "auto" | "disabled" };
  oidc?: { client_id: string; client_secret: string };
};
type Project = {
  schemas: Record<string, Schema>;
  flows: Record<string, { schemaPath?: string; body: { steps: Step[] } }>;
  connections: Record<string, Connection>;
};

const STAFF = ".zitadel/schemas/staff.json";
const PARTNERS = ".zitadel/schemas/partners.json";
const LOGIN = ".zitadel/flows/login.json";
const GOOGLE = ".zitadel/idps/google.json";

const ALL_OUTCOMES = ["sso_authenticated", "sso_user_not_found", "user_already_exists", "submit"];

const aStep = (name: string, over: Partial<Step> = {}, routes = ALL_OUTCOMES): Step => ({
  name,
  fields: ["email"],
  transitions: Object.fromEntries(routes.map((route) => [route, { target: "done" }])),
  ...over,
});

const aSchema = (over: Partial<Schema["x-auth-methods"]["sso"]> = {}, properties = {}): Schema => ({
  properties: { email: {}, ...properties },
  "x-auth-methods": { sso: { enabled: true, providers: ["google"], ...over } },
});

/** A project that agrees with itself: one schema, one flow offering Google, one connection. */
function aProject(): Project {
  return {
    schemas: { [STAFF]: aSchema() },
    flows: {
      [LOGIN]: {
        schemaPath: STAFF,
        body: {
          steps: [
            aStep("identifier", { sso_providers: ["google"] }),
            aStep("register-sso", { on_success: "create_user_with_sso" }),
          ],
        },
      },
    },
    connections: { [GOOGLE]: { slug: "google", claim_mapping: { email: "email" } } },
  };
}

const toTree = (project: Project): ProjectTree => ({
  schemas: new Map(Object.entries(project.schemas)),
  flows: new Map(Object.entries(project.flows)),
  connections: new Map(Object.entries(project.connections)),
});

/** The issues for the valid project after `edit` has changed it. */
function validate(edit: (project: Project) => void = () => {}) {
  const project = aProject();
  edit(project);
  return validateProject(toTree(project));
}

/** A step of the login flow, or a failure that says the builder changed. */
function stepOf(project: Project, name: string): Step {
  const step = project.flows[LOGIN]?.body.steps.find((candidate) => candidate.name === name);
  if (step === undefined) {
    throw new Error(`the project has no ${name} step`);
  }
  return step;
}

const schemaOf = (project: Project, path = STAFF): Schema => {
  const schema = project.schemas[path];
  if (schema === undefined) {
    throw new Error(`the project has no ${path}`);
  }
  return schema;
};

const connectionOf = (project: Project, path = GOOGLE): Connection => {
  const connection = project.connections[path];
  if (connection === undefined) {
    throw new Error(`the project has no ${path}`);
  }
  return connection;
};

type Expected = {
  rule: ProjectRuleId;
  file: string;
  steps?: string[];
  /** Fragments of the message: the name at fault, and the fix. */
  says: string[];
};

/** One rule broken in one way: what to change in the valid project, and what must come back. */
const broken: Array<{ name: string; edit: (project: Project) => void; expect: Expected[] }> = [
  {
    name: "a step offers a provider, and the schema has sso switched off",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso = { enabled: false, providers: [] };
    },
    expect: [
      {
        rule: "sso/flow-enables-sso",
        file: LOGIN,
        steps: ["identifier"],
        says: ["identifier", "not an enabled authentication method", "remove sso_providers"],
      },
    ],
  },
  {
    name: "a step offers google and the schema lists only github",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["github"];
      p.connections[".zitadel/idps/github.json"] = {
        slug: "github",
        claim_mapping: { email: "e" },
      };
    },
    expect: [
      {
        rule: "sso/provider-id",
        file: LOGIN,
        steps: ["identifier"],
        says: ["google", "not listed in sso.providers", "Add it there"],
      },
    ],
  },
  {
    name: "the schema and a step both name google and no connection file has that slug",
    edit: (p) => {
      p.connections = {};
    },
    expect: [
      {
        rule: "sso/connection-resolves",
        file: STAFF,
        says: ["sso.providers", "google", "Add the file"],
      },
      {
        rule: "sso/connection-resolves",
        file: LOGIN,
        steps: ["identifier"],
        says: ["identifier", "google"],
      },
    ],
  },
  {
    name: "two connection files claim the same slug",
    edit: (p) => {
      p.connections["copy.json"] = structuredClone(connectionOf(p));
    },
    expect: [
      {
        rule: "sso/duplicate-slug",
        file: "copy.json",
        says: ["google", GOOGLE, "one connection"],
      },
    ],
  },
  {
    name: "two connection files name the same variable",
    edit: (p) => {
      connectionOf(p).oidc = {
        client_id: "${{ SHARED_ID }}",
        client_secret: "${{ SHARED_SECRET }}",
      };
      p.connections["other.json"] = { ...structuredClone(connectionOf(p)), slug: "other" };
    },
    expect: [
      {
        rule: "sso/shared-variable",
        file: "other.json",
        says: ["client_id", "also uses", "own variable"],
      },
      {
        rule: "sso/shared-variable",
        file: "other.json",
        says: ["client_secret", "also uses", "own variable"],
      },
    ],
  },
  {
    name: "a step offers a provider and routes only sso_authenticated",
    edit: (p) => {
      stepOf(p, "identifier").transitions = { sso_authenticated: { target: "done" } };
    },
    expect: [
      {
        rule: "sso/outcome-routing",
        file: LOGIN,
        steps: ["identifier"],
        says: ["sso_user_not_found, user_already_exists", "Add a transition"],
      },
    ],
  },
  {
    name: "the collection step does not route user_already_exists",
    edit: (p) => {
      stepOf(p, "register-sso").transitions = { submit: { target: "done" } };
    },
    expect: [
      {
        rule: "sso/collection-conflict-routing",
        file: LOGIN,
        steps: ["register-sso"],
        says: ["register-sso", "user_already_exists"],
      },
    ],
  },
  {
    name: "the connection maps nothing, so no sign-in can fill the user",
    edit: (p) => {
      connectionOf(p).claim_mapping = {};
    },
    expect: [
      {
        rule: "sso/empty-claim-mapping",
        file: LOGIN,
        steps: ["identifier"],
        says: ["google", "is empty", "Map at least one property"],
      },
    ],
  },
  {
    name: "the connection maps nothing the schema defines",
    edit: (p) => {
      connectionOf(p).claim_mapping = { emailAddress: "mail" };
    },
    expect: [
      {
        rule: "sso/empty-claim-mapping",
        file: LOGIN,
        steps: ["identifier"],
        says: ["maps nothing"],
      },
      { rule: "sso/orphaned-mapping-target", file: GOOGLE, says: ["emailAddress"] },
    ],
  },
  {
    name: "verified_claims names a key that claim_mapping does not map",
    edit: (p) => {
      schemaOf(p).properties.givenName = {};
      connectionOf(p).verified_claims = { givenName: "given_name_verified" };
    },
    expect: [
      {
        rule: "sso/unmapped-verification-key",
        file: GOOGLE,
        says: ["givenName", "no claim_mapping entry", "remove it from verified_claims"],
      },
    ],
  },
  {
    name: "claim_mapping targets a property no schema defines",
    edit: (p) => {
      connectionOf(p).claim_mapping = { email: "email", emailAddress: "mail" };
    },
    expect: [
      { rule: "sso/orphaned-mapping-target", file: GOOGLE, says: ["emailAddress", "Fix the name"] },
    ],
  },
  {
    name: "a mapped, verified key is a property no schema defines",
    edit: (p) => {
      connectionOf(p).claim_mapping = { email: "email", nickname: "nick" };
      connectionOf(p).verified_claims = { nickname: "nick_verified" };
    },
    // A mapped key a schema does not define is both an orphaned target and an orphaned verification key.
    expect: [
      { rule: "sso/orphaned-mapping-target", file: GOOGLE, says: ["nickname"] },
      {
        rule: "sso/orphaned-verification-key",
        file: GOOGLE,
        says: ["nickname", "can never verify"],
      },
    ],
  },
];

/** The edits that sit on a rule's boundary and must be accepted. */
const accepted: Array<{ name: string; edit: (project: Project) => void }> = [
  { name: "the project as scaffolded", edit: () => {} },
  {
    name: "a schema with sso off that no flow offers providers from",
    edit: (p) => {
      p.schemas[PARTNERS] = aSchema({ enabled: false, providers: [] });
    },
  },
  {
    name: "two providers on one step, both listed",
    edit: (p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["google", "github"];
      stepOf(p, "identifier").sso_providers = ["google", "github"];
      p.connections[".zitadel/idps/github.json"] = {
        slug: "github",
        claim_mapping: { email: "e" },
      };
    },
  },
  {
    name: "a connection found by its slug, not its file name",
    edit: (p) => {
      p.connections = { ".zitadel/idps/sso.json": connectionOf(p) };
    },
  },
  {
    name: "a step with no providers that routes none of the provider outcomes",
    edit: (p) => {
      p.flows[LOGIN]?.body.steps.push(aStep("password", {}, ["submit"]));
    },
  },
  {
    name: "a plain create_user step with no conflict route",
    edit: (p) => {
      p.flows[LOGIN]?.body.steps.push(
        aStep("register-password", { on_success: "create_user" }, ["submit"]),
      );
    },
  },
  {
    name: "a nested mapping name that resolves",
    edit: (p) => {
      schemaOf(p).properties.address = { properties: { street: {} } };
      connectionOf(p).claim_mapping = { "address.street": "street" };
    },
  },
  {
    name: "a target only one of two referencing schemas defines",
    edit: (p) => {
      schemaOf(p).properties.staffNumber = {};
      p.schemas[PARTNERS] = aSchema();
      connectionOf(p).claim_mapping = { email: "email", staffNumber: "employee_id" };
      connectionOf(p).verified_claims = { staffNumber: "employee_verified" };
    },
  },
  {
    name: "a provider that only signs people in, with no mapping and only sso_authenticated routed",
    edit: (p) => {
      connectionOf(p).provisioning = { creation: "disabled" };
      connectionOf(p).claim_mapping = {};
      stepOf(p, "identifier").transitions = { sso_authenticated: { target: "done" } };
    },
  },
  {
    name: "a connection no schema lists and no flow offers",
    edit: (p) => {
      p.connections[".zitadel/idps/spare.json"] = {
        slug: "spare",
        claim_mapping: { typo: "x" },
        verified_claims: { other: "y" },
      };
    },
  },
];

describe("validateProject: the SSO rules", () => {
  describe.each(broken)("when $name", ({ edit, expect: expected }) => {
    it("reports exactly what is wrong, where, and what to change", () => {
      const issues = validate(edit);

      expect(issues.map(({ rule, file, steps }) => ({ rule, file, steps }))).toEqual(
        expected.map(({ rule, file, steps }) => ({ rule, file, steps })),
      );
      for (const [index, { says }] of expected.entries()) {
        for (const fragment of says) {
          expect(issues[index]?.message).toContain(fragment);
        }
      }
    });

    it("is reported as an error under a rule the registry knows at project scope", () => {
      for (const issue of validate(edit)) {
        expect(issue.severity).toBe("error");
        expect(VALIDATION_RULES[issue.rule].scope).toBe("project");
      }
    });
  });

  it.each(accepted)("accepts $name", ({ edit }) => {
    expect(validate(edit)).toEqual([]);
  });

  it("has a failing case for every project rule in the registry", () => {
    const covered = new Set(broken.flatMap(({ expect: e }) => e.map(({ rule }) => rule)));
    const registered = Object.entries(VALIDATION_RULES)
      .filter(([, spec]) => spec.scope === "project")
      .map(([rule]) => rule);

    expect([...covered].sort()).toEqual(registered.sort());
  });
});

describe("how the rules read the project", () => {
  it("judges a mapping target against the schemas that list the connection, not all of them", () => {
    // `contactEmail` exists, but only in a schema that does not list google.
    const issues = validate((p) => {
      p.schemas[PARTNERS] = aSchema({ providers: [] }, { contactEmail: {} });
      connectionOf(p).claim_mapping = { email: "email", contactEmail: "mail" };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/orphaned-mapping-target"]);
  });

  it("reports one cause once, however many steps it is made on", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["other"];
      p.connections[".zitadel/idps/other.json"] = { slug: "other", claim_mapping: { email: "e" } };
      p.flows[LOGIN]?.body.steps.push(
        aStep("register", { sso_providers: ["google"] }),
        aStep("sso-conflict", { sso_providers: ["google"] }),
      );
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.steps).toEqual(["identifier", "register", "sso-conflict"]);
    expect(issues[0]?.message).toContain('steps "identifier", "register", "sso-conflict"');
  });

  it("still checks a flow's routing when its schema could not be found", () => {
    const issues = validate((p) => {
      delete p.flows[LOGIN]?.schemaPath;
      stepOf(p, "identifier").transitions = {};
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
    expect(issues[0]?.message).toContain(
      "sso_authenticated, sso_user_not_found, user_already_exists",
    );
  });

  it("needs the register routes again when another provider on the step creates users", () => {
    const issues = validate((p) => {
      connectionOf(p).provisioning = { creation: "disabled" };
      p.connections[".zitadel/idps/other.json"] = { slug: "other", claim_mapping: { email: "e" } };
      schemaOf(p)["x-auth-methods"].sso.providers = ["google", "other"];
      const identifier = stepOf(p, "identifier");
      identifier.sso_providers = ["google", "other"];
      identifier.transitions = { sso_authenticated: { target: "done" } };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
  });

  it("still needs sso_authenticated from a provider that only signs people in", () => {
    const issues = validate((p) => {
      connectionOf(p).provisioning = { creation: "disabled" };
      stepOf(p, "identifier").transitions = {};
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/outcome-routing"]);
  });

  it("judges a connection a flow offers even when no schema lists it", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = [];
      connectionOf(p).verified_claims = { other: "x" };
    });

    expect(issues.map((issue) => issue.rule)).toContain("sso/unmapped-verification-key");
  });

  it("reads a connection by its slug, and the first file in path order stands for a duplicate", () => {
    const issues = validate((p) => {
      p.connections = {
        "b.json": { slug: "google", claim_mapping: { email: "email" } },
        "a.json": { slug: "google", claim_mapping: { typo: "x" } },
      };
    });

    // a.json is judged, on the step that offers it and as a file; b.json is
    // only named as the duplicate.
    expect(issues.map(({ rule, file }) => ({ rule, file }))).toEqual([
      { rule: "sso/duplicate-slug", file: "b.json" },
      { rule: "sso/empty-claim-mapping", file: LOGIN },
      { rule: "sso/orphaned-mapping-target", file: "a.json" },
    ]);
  });

  it("does not also report the missing listing when sso is off, which one error already says", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso = { enabled: false, providers: [] };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/flow-enables-sso"]);
  });

  it("collects every issue instead of stopping at the first", () => {
    const issues = validate((p) => {
      schemaOf(p)["x-auth-methods"].sso.providers = ["a", "b"];
      p.connections = {};
    });

    // Two providers the schema lists with no file, then the one the flow offers
    // that the schema does not list and no file backs either.
    expect(issues.map((issue) => issue.rule)).toEqual([
      "sso/connection-resolves",
      "sso/connection-resolves",
      "sso/connection-resolves",
      "sso/provider-id",
    ]);
  });

  it("does not ask for a claim_mapping row where verified_claims reads no claim", () => {
    const issues = validate((p) => {
      connectionOf(p).verified_claims = { email: "$supplementary_fetch" };
      connectionOf(p).claim_mapping = {};
    });

    expect(issues.map((issue) => issue.rule)).not.toContain("sso/unmapped-verification-key");
  });

  it("names a verified_claims key that no schema has once, not twice", () => {
    const issues = validate((p) => {
      connectionOf(p).verified_claims = { typo: "email_verified" };
    });

    expect(
      issues.map((issue) => issue.rule).filter((rule) => rule.includes("verification")),
    ).toEqual(["sso/orphaned-verification-key"]);
  });

  it("does not take prototype keys for mapped properties", () => {
    const issues = validate((p) => {
      connectionOf(p).claim_mapping = { email: "email", constructor: "x" };
    });

    expect(issues.map((issue) => issue.rule)).toEqual(["sso/orphaned-mapping-target"]);
  });
});
