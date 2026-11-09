import { describe, expect, it } from "vitest";

import { type ConfigOptions, type Issue, type JsonObject, ZitadelConfig } from "@/lib/zitadel";
import { isJsonObject, listAt } from "@/lib/zitadel/utils/json";
import { SSO_RULES } from "@/lib/zitadel/rules/sso";
import {
  aConfig,
  anOidcConnection,
  aUserSchema,
  type ConfigDocuments,
  configFiles,
} from "@tests/helpers/config";
import { aFlowOffering, aSchemaListing, HUMAN_USER } from "@tests/helpers/schemas";

/**
 * The file name of the schema in these tests.
 */
const SCHEMA_FILE = "staff.json";

/**
 * Where the schema in these tests sits.
 */
const SCHEMA_PATH = `.zitadel/schemas/${SCHEMA_FILE}`;

/**
 * The file name of the flow in these tests.
 */
const FLOW_FILE = "login.json";

/**
 * Where the flow in these tests sits.
 */
const FLOW_PATH = `.zitadel/flows/${FLOW_FILE}`;

/**
 * The file name of the connection in these tests.
 */
const CONNECTION_FILE = "acme.json";

/**
 * Where the connection in these tests sits.
 */
const CONNECTION_PATH = `.zitadel/idps/${CONNECTION_FILE}`;

/**
 * The file name of a second connection claiming the same slug.
 */
const COPY_FILE = "copy.json";

/**
 * The `$id` a schema and the flow pinning it may both name.
 */
const SCHEMA_ID = "https://schemas.example.test/staff.json";

/**
 * The connection the schema and flow name, mapping the email claim it asks
 * for.
 */
const ACME = anOidcConnection({
  claim_mapping: { email: "email" },
  oidc: { scopes: ["openid", "email"] },
});

/**
 * A second connection claiming {@link ACME}'s slug, with a secret of its own.
 */
const ACME_COPY = anOidcConnection({
  claim_mapping: { email: "email" },
  oidc: { scopes: ["openid", "email"], client_secret: "${{ COPY_CLIENT_SECRET }}" },
});

/**
 * The ids of the two rules that judge a verified key.
 */
const VERIFICATION_RULES: readonly string[] = [
  "sso/orphaned-verification-key",
  "sso/unmapped-verification-key",
];

describe("SSO_RULES", () => {
  it("find nothing in a project whose files agree", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      connections: { [CONNECTION_FILE]: ACME },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([]);
  });

  it("find nothing in a project with no SSO files at all", () => {
    const config = aConfig();

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([]);
  });

  it("refuse a provider the pinned schema does not list, naming the flow file and its step", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      connections: { [CONNECTION_FILE]: ACME },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toContainEqual({
      severity: "error",
      rule: "sso/provider-id",
      file: FLOW_PATH,
      steps: ["identifier"],
      message: `step "identifier": sso provider "acme" is not listed in sso.providers of ${SCHEMA_PATH}. Add it there, or remove it from the flow.`,
    });
  });

  it("refuse a schema that lists a provider with no connection file, naming the schema", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([
      {
        severity: "error",
        rule: "sso/connection-resolves",
        file: SCHEMA_PATH,
        slug: "acme",
        message:
          'sso.providers lists "acme" but there is no connection file with that slug under .zitadel/idps/. Add the file, or remove "acme" from sso.providers.',
      },
    ]);
  });

  it.each([
    {
      where: "a schema lists it",
      documents: { schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) } },
    },
    {
      where: "a flow offers it",
      documents: { flows: { [FLOW_FILE]: aFlowOffering(["acme"]) } },
    },
  ])(
    "leave a slug held by a connection file its contract refuses to that file's own findings when $where",
    ({ documents }) => {
      const config = aConfig({
        ...documents,
        connections: { [CONNECTION_FILE]: anOidcConnection({ display_name: undefined }) },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(config.broken.map((file) => file.path)).toEqual([CONNECTION_PATH]);
      expect(
        issues.filter((issue) => {
          return issue.rule === "sso/connection-resolves";
        }),
      ).toEqual([]);
    },
  );

  it.each([
    {
      where: "a schema lists it",
      documents: { schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) } },
    },
    {
      where: "a flow offers it",
      documents: { flows: { [FLOW_FILE]: aFlowOffering(["acme"]) } },
    },
  ])(
    "leave a slug named by a connection file that cannot be parsed to that file's own findings when $where",
    ({ documents }) => {
      const config = ZitadelConfig.of({
        ...configFiles(documents),
        connections: [{ path: CONNECTION_PATH, unparsed: "invalid JSON at position 2" }],
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(config.broken.map((file) => file.path)).toEqual([CONNECTION_PATH]);
      expect(
        issues.filter((issue) => {
          return issue.rule === "sso/connection-resolves";
        }),
      ).toEqual([]);
    },
  );

  it("leave a slug named by a broken connection file with no slug to that file's own findings", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
      connections: { [CONNECTION_FILE]: anOidcConnection({ slug: undefined }) },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(config.broken.map((file) => file.path)).toEqual([CONNECTION_PATH]);
    expect(
      issues.filter((issue) => {
        return issue.rule === "sso/connection-resolves";
      }),
    ).toEqual([]);
  });

  it("refuse a provider the schema does not list when only a broken connection file holds it", () => {
    const config = aConfig({
      schemas: { [SCHEMA_FILE]: aSchemaListing(["other"]) },
      flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      connections: { [CONNECTION_FILE]: anOidcConnection({ display_name: undefined }) },
    });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(
      issues.filter((issue) => {
        return issue.rule === "sso/provider-id" && issue.file === FLOW_PATH;
      }),
    ).toHaveLength(1);
  });

  it("refuse a second connection file that claims a slug, naming the first", () => {
    const config = aConfig({ connections: { [CONNECTION_FILE]: ACME, [COPY_FILE]: ACME_COPY } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([
      {
        severity: "error",
        rule: "sso/duplicate-slug",
        file: `.zitadel/idps/${COPY_FILE}`,
        message: `connection slug "acme" is also used by ${CONNECTION_PATH}. A slug names one connection: change the slug here, or delete one of the two files.`,
      },
    ]);
  });

  it("report every problem, one issue each", () => {
    const config = aConfig({ schemas: { [SCHEMA_FILE]: aSchemaListing(["acme", "ghost"]) } });

    const issues = SSO_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toMatchObject([{ slug: "acme" }, { slug: "ghost" }]);
  });

  describe("when finding the schema a flow pins", () => {
    it.each([
      ["objectType", aSchemaListing(["other"]), HUMAN_USER],
      ["$id", aSchemaListing(["other"], { $id: SCHEMA_ID }), SCHEMA_ID],
    ])("matches a flow's user_schema to a schema's %s", (_key, schema, userSchema) => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: schema },
        flows: { [FLOW_FILE]: aFlowOffering(["acme"], userSchema) },
        connections: { [CONNECTION_FILE]: ACME },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(expect.objectContaining({ rule: "sso/provider-id" }));
    });

    it("does not hold a flow to a schema the project does not keep locally", () => {
      const config = aConfig({
        flows: { [FLOW_FILE]: aFlowOffering(["acme"], "not-kept-here") },
        connections: { [CONNECTION_FILE]: ACME },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toEqual([]);
    });
  });

  describe("when a connection verifies a key it does not map", () => {
    /**
     * A connection verifying `email` while mapping nothing.
     */
    const UNMAPPED = anOidcConnection({ verified_claims: { email: "email_verified" } });

    it("refuses it when a schema lists the connection", () => {
      const config = aConfig({
        schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
        connections: { [CONNECTION_FILE]: UNMAPPED },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(
        expect.objectContaining({ rule: "sso/unmapped-verification-key", file: CONNECTION_PATH }),
      );
    });

    it("refuses it when a flow offers the connection", () => {
      const config = aConfig({
        flows: { [FLOW_FILE]: aFlowOffering(["acme"], "not-kept-here") },
        connections: { [CONNECTION_FILE]: UNMAPPED },
      });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      });

      expect(issues).toContainEqual(
        expect.objectContaining({ rule: "sso/unmapped-verification-key", file: CONNECTION_PATH }),
      );
    });

    it("leaves it alone when nothing lists or offers the connection", () => {
      const config = aConfig({ connections: { [CONNECTION_FILE]: UNMAPPED } });

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(config, {});
      }).filter((issue) => {
        return issue.rule === "sso/unmapped-verification-key";
      });

      expect(issues).toEqual([]);
    });
  });

  describe("when a rule reads the files together", () => {
    /**
     * A second connection, `other`, that nobody lists or offers.
     */
    const OTHER_PATH = ".zitadel/idps/other.json";

    /**
     * The schema listing `acme`, with a property whose type is a number.
     */
    const NUMERIC_EMAIL_SCHEMA = aSchemaListing(["acme"], {
      properties: { email: { "x-unique": "project", type: "integer" } },
    });

    /**
     * Every project below lists `acme` in its schema, offers it in its flow
     * and keeps the connection `acme.json`: the documents of a project whose
     * files agree, but for what a row changes.
     *
     * @param connection - The connection file `acme.json` holds.
     * @param overrides - Documents to set in place of the agreeing ones.
     * @returns The documents.
     */
    function agreeing(connection: JsonObject, overrides: ConfigDocuments = {}): ConfigDocuments {
      return {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
        flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
        connections: { [CONNECTION_FILE]: connection },
        ...overrides,
      };
    }

    /**
     * A flow whose entry step offers `acme` and whose other steps are as given.
     *
     * @param step - Keys to set on the entry step in place of the routed ones.
     * @param extra - Further steps.
     * @returns The flow document.
     */
    function aFlowStepping(step: JsonObject, extra: readonly JsonObject[] = []): JsonObject {
      const offering = aFlowOffering(["acme"]);
      const entry = listAt(offering, "steps")[0];
      return { ...offering, steps: [{ ...(isJsonObject(entry) ? entry : {}), ...step }, ...extra] };
    }

    /**
     * Find the issues of one rule.
     *
     * @param rule - The rule's id.
     * @param documents - The project's documents.
     * @param options - What is known beyond the files.
     * @returns The rule's issues.
     */
    function issuesOf(
      rule: string,
      documents: ConfigDocuments,
      options: ConfigOptions = {},
    ): readonly Issue[] {
      return SSO_RULES.flatMap((candidate) => {
        return candidate.check(aConfig(documents, options), {});
      }).filter((issue) => {
        return issue.rule === rule;
      });
    }

    it.each([
      {
        rule: "sso/shared-variable",
        severity: "error",
        documents: {
          connections: {
            [CONNECTION_FILE]: ACME,
            "other.json": anOidcConnection({ slug: "other" }),
          },
        },
        file: OTHER_PATH,
        message: "client_secret names the variable ACME_CLIENT_SECRET",
      },
      {
        rule: "sso/flow-enables-sso",
        severity: "error",
        documents: agreeing(ACME, { schemas: { [SCHEMA_FILE]: aUserSchema() } }),
        file: FLOW_PATH,
        message: `offers sso_providers but "sso" is not an enabled authentication method in ${SCHEMA_PATH}`,
      },
      {
        rule: "sso/outcome-routing",
        severity: "error",
        documents: agreeing(ACME, {
          flows: {
            [FLOW_FILE]: aFlowStepping({ transitions: { sso_authenticated: { target: "done" } } }),
          },
        }),
        file: FLOW_PATH,
        message:
          "does not route sso_user_not_found, user_already_exists. Add a transition for each.",
      },
      {
        rule: "sso/outcome-routing",
        severity: "error",
        documents: agreeing(ACME, {
          flows: {
            [FLOW_FILE]: aFlowStepping({
              transitions: {
                sso_authenticated: { target: "done" },
                sso_user_not_found: { target: "register-sso" },
                user_already_exists: { action: "switch", target: "sso-conflict" },
              },
            }),
          },
        }),
        file: FLOW_PATH,
        message: "does not route user_already_exists. A collision is followed only through",
      },
      {
        rule: "sso/collection-conflict-routing",
        severity: "error",
        documents: agreeing(ACME, {
          flows: {
            [FLOW_FILE]: aFlowStepping({
              on_success: "create_user_with_sso",
              transitions: {
                sso_authenticated: { target: "done" },
                sso_user_not_found: { target: "register-sso" },
              },
            }),
          },
        }),
        file: FLOW_PATH,
        message:
          "on_success create_user_with_sso must route user_already_exists. Add that transition.",
      },
      {
        rule: "sso/empty-claim-mapping",
        severity: "error",
        documents: agreeing(anOidcConnection({ claim_mapping: {} })),
        file: FLOW_PATH,
        message: `claim_mapping of "acme" (${CONNECTION_PATH}) is empty, so no sign-in can fill the user`,
      },
      {
        rule: "sso/claim-needs-scope",
        severity: "warning",
        documents: agreeing(anOidcConnection({ claim_mapping: { email: "email" } })),
        file: CONNECTION_PATH,
        message: 'claim_mapping reads "email", which a provider only returns for the "email" scope',
      },
      {
        rule: "sso/verification-source-not-boolean",
        severity: "warning",
        documents: agreeing(
          anOidcConnection({
            claim_mapping: { email: "email" },
            verified_claims: { email: "email" },
            oidc: { scopes: ["openid", "email"] },
          }),
        ),
        file: CONNECTION_PATH,
        message: 'verified_claims reads "email" to verify "email", but that is a string claim',
      },
      {
        rule: "sso/claim-name-whitespace",
        severity: "error",
        documents: agreeing(
          anOidcConnection({
            claim_mapping: { email: " email" },
            oidc: { scopes: ["openid", "email"] },
          }),
        ),
        file: CONNECTION_PATH,
        message: 'claim_mapping names " email", which has a space at its start or end',
      },
      {
        rule: "sso/claim-name-whitespace",
        severity: "error",
        documents: agreeing(anOidcConnection({ subject_claim: "oid " })),
        file: CONNECTION_PATH,
        message: 'subject_claim names "oid "',
      },
      {
        rule: "sso/subject-claim-unstable",
        severity: "warning",
        documents: agreeing(anOidcConnection({ subject_claim: "email" })),
        file: CONNECTION_PATH,
        message: 'subject_claim is "email", a profile claim the user can change',
      },
      {
        rule: "sso/subject-claim-unstable",
        severity: "warning",
        documents: agreeing(anOidcConnection({ subject_claim: "username" })),
        file: CONNECTION_PATH,
        message: 'subject_claim is "username"',
      },
      {
        rule: "sso/claim-type-mismatch",
        severity: "warning",
        documents: agreeing(
          anOidcConnection({
            claim_mapping: { email: "email" },
            oidc: { scopes: ["openid", "email"] },
          }),
          { schemas: { [SCHEMA_FILE]: NUMERIC_EMAIL_SCHEMA } },
        ),
        file: CONNECTION_PATH,
        message: 'reads "email", a string claim, into "email", which the schema types as integer',
      },
      {
        rule: "sso/orphaned-mapping-target",
        severity: "error",
        documents: agreeing(
          anOidcConnection({
            claim_mapping: { emial: "email" },
            oidc: { scopes: ["openid", "email"] },
          }),
        ),
        file: CONNECTION_PATH,
        message:
          'claim_mapping target "emial" is not a property of any schema that lists "acme" in sso.providers. Did you mean',
      },
      {
        rule: "sso/orphaned-verification-key",
        severity: "error",
        documents: agreeing(anOidcConnection({ verified_claims: { emial: true } })),
        file: CONNECTION_PATH,
        message:
          'verified_claims key "emial" is not a property of any schema that lists "acme" in sso.providers, so it can never verify.',
      },
    ] satisfies readonly {
      readonly rule: string;
      readonly severity: string;
      readonly documents: ConfigDocuments;
      readonly file: string;
      readonly message: string;
    }[])("$rule fires: $message", (row) => {
      const issues = issuesOf(row.rule, row.documents);

      expect(issues).toMatchObject([
        {
          severity: row.severity,
          rule: row.rule,
          file: row.file,
          message: expect.stringContaining(row.message),
        },
      ]);
    });

    it.each([
      {
        rule: "sso/shared-variable",
        documents: {
          connections: {
            [CONNECTION_FILE]: ACME,
            "other.json": anOidcConnection({
              slug: "other",
              oidc: { client_secret: "${{ OTHER_SECRET }}" },
            }),
          },
        },
      },
      { rule: "sso/flow-enables-sso", documents: agreeing(ACME) },
      { rule: "sso/outcome-routing", documents: agreeing(ACME) },
      {
        rule: "sso/outcome-routing",
        documents: agreeing(
          anOidcConnection({
            claim_mapping: { email: "email" },
            provisioning: { creation: "disabled" },
          }),
          {
            flows: {
              [FLOW_FILE]: aFlowStepping({
                transitions: { sso_authenticated: { target: "done" } },
              }),
            },
          },
        ),
      },
      { rule: "sso/collection-conflict-routing", documents: agreeing(ACME) },
      { rule: "sso/empty-claim-mapping", documents: agreeing(ACME) },
      {
        rule: "sso/empty-claim-mapping",
        documents: agreeing(anOidcConnection({ claim_mapping: { nickname: "name" } })),
      },
      {
        rule: "sso/empty-claim-mapping",
        documents: agreeing(
          anOidcConnection({ claim_mapping: {}, provisioning: { creation: "disabled" } }),
        ),
      },
      { rule: "sso/claim-needs-scope", documents: agreeing(ACME) },
      {
        rule: "sso/claim-needs-scope",
        documents: agreeing(
          anOidcConnection({
            claim_mapping: { email: "email" },
            oidc: { scopes: ["openid", "custom"] },
          }),
        ),
      },
      {
        rule: "sso/verification-source-not-boolean",
        documents: agreeing(
          anOidcConnection({
            claim_mapping: { email: "email" },
            verified_claims: { email: "email_verified" },
            oidc: { scopes: ["openid", "email"] },
          }),
        ),
      },
      { rule: "sso/claim-name-whitespace", documents: agreeing(ACME) },
      {
        rule: "sso/subject-claim-unstable",
        documents: agreeing(anOidcConnection({ subject_claim: "sub" })),
      },
      {
        rule: "sso/subject-claim-unstable",
        documents: agreeing(anOidcConnection({ subject_claim: "oid" })),
      },
      { rule: "sso/claim-type-mismatch", documents: agreeing(ACME) },
      {
        rule: "sso/claim-type-mismatch",
        documents: agreeing(ACME, {
          schemas: {
            [SCHEMA_FILE]: aSchemaListing(["acme"], {
              properties: { email: { "x-unique": "project", type: "string" } },
            }),
          },
        }),
      },
      { rule: "sso/orphaned-mapping-target", documents: agreeing(ACME) },
      {
        rule: "sso/orphaned-mapping-target",
        documents: {
          connections: {
            [CONNECTION_FILE]: anOidcConnection({ claim_mapping: { emial: "email" } }),
          },
        },
      },
      {
        rule: "sso/orphaned-verification-key",
        documents: agreeing(
          anOidcConnection({ claim_mapping: { email: "email" }, verified_claims: { email: true } }),
        ),
      },
      {
        rule: "sso/orphaned-verification-key",
        documents: {
          connections: {
            [CONNECTION_FILE]: anOidcConnection({ verified_claims: { emial: true } }),
          },
        },
      },
    ] satisfies readonly { readonly rule: string; readonly documents: ConfigDocuments }[])(
      "$rule stays silent on a project that does not break it",
      (row) => {
        const issues = issuesOf(row.rule, row.documents);

        expect(issues).toEqual([]);
      },
    );

    it("reports a connection both a schema and a flow name once, on the schema", () => {
      const documents = {
        schemas: { [SCHEMA_FILE]: aSchemaListing(["acme"]) },
        flows: { [FLOW_FILE]: aFlowOffering(["acme"]) },
      };

      const issues = issuesOf("sso/connection-resolves", documents);

      expect(issues).toMatchObject([{ file: SCHEMA_PATH, slug: "acme" }]);
    });

    it("says only that a verified key no schema defines is orphaned", () => {
      const documents = agreeing(anOidcConnection({ verified_claims: { emial: true } }));

      const issues = SSO_RULES.flatMap((rule) => {
        return rule.check(aConfig(documents), {});
      }).filter((issue) => {
        return VERIFICATION_RULES.includes(issue.rule);
      });

      expect(issues).toMatchObject([{ rule: "sso/orphaned-verification-key" }]);
    });

    it("leaves a verified key unmapped only by a typo to the typo's own finding", () => {
      const documents = agreeing(
        anOidcConnection({
          claim_mapping: { emial: "email" },
          verified_claims: { email: "email_verified" },
          oidc: { scopes: ["openid", "email"] },
        }),
      );

      const issues = issuesOf("sso/unmapped-verification-key", documents);

      expect(issues).toEqual([]);
    });

    it("still reports a verified key no mapping is a typo of", () => {
      const documents = agreeing(
        anOidcConnection({
          claim_mapping: { nickname: "name" },
          verified_claims: { email: "email_verified" },
          oidc: { scopes: ["openid", "email"] },
        }),
      );

      const issues = issuesOf("sso/unmapped-verification-key", documents);

      expect(issues).toMatchObject([{ file: CONNECTION_PATH }]);
    });

    it("still asks a step offering a provider with no connection file to route a new user", () => {
      const documents = {
        flows: {
          [FLOW_FILE]: aFlowStepping({ transitions: { sso_authenticated: { target: "done" } } }),
        },
      };

      const issues = issuesOf("sso/outcome-routing", documents);

      expect(issues).toMatchObject([
        {
          message: expect.stringContaining(
            "does not route sso_user_not_found, user_already_exists",
          ),
        },
      ]);
    });

    it("does not warn about an unstable subject once the connection is deployed", () => {
      const documents = agreeing(anOidcConnection({ subject_claim: "email" }));

      const issues = issuesOf("sso/subject-claim-unstable", documents, {
        deployed: new Set(["acme"]),
      });

      expect(issues).toEqual([]);
    });
  });
});
