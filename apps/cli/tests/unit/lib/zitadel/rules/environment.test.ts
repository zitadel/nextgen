import { describe, expect, it } from "vitest";

import type { Issue, ValidationContext } from "@/lib/zitadel";
import { ENVIRONMENT_RULES } from "@/lib/zitadel/rules/environment";
import { aBranding, aConfig, aLoginFlow, aStore, aUserSchema } from "@tests/helpers/config";

/**
 * Where the schema in these tests sits.
 */
const SCHEMA_PATH = ".zitadel/schemas/staff.json";

/**
 * Where the flow in these tests sits.
 */
const FLOW_PATH = ".zitadel/flows/login.json";

/**
 * Where the branding in these tests sits.
 */
const BRANDING_PATH = ".zitadel/branding/brand.json";

/**
 * A schema whose `$id` names an inline variable that nothing sets.
 */
const SCHEMA_WITH_VARIABLE = aUserSchema({ $id: "https://${SCHEMA_HOST}/staff.json" });

/**
 * A flow naming a variable inline.
 */
const FLOW_WITH_VARIABLE = { ...aLoginFlow(), audience: { app_ids: ["${FLOW_APP}"] } };

/**
 * A branding whose inline template names a variable.
 */
const BRANDING_WITH_VARIABLE = aBranding({
  liquid_template: "<zl-page-shell>${BRAND_TITLE}{% mandatory_gates %}</zl-page-shell>",
});

/**
 * Run the environment rules.
 *
 * @param config - The configuration to check.
 * @param context - What the run knows beyond the files.
 * @returns Every finding.
 */
function environmentIssues(
  config: ReturnType<typeof aConfig>,
  context: ValidationContext,
): readonly Issue[] {
  return ENVIRONMENT_RULES.flatMap((rule) => {
    return rule.check(config, context);
  });
}

describe("ENVIRONMENT_RULES", () => {
  describe("environment/missing-variable", () => {
    it.each([
      ["a schema", { schemas: { "staff.json": SCHEMA_WITH_VARIABLE } }, SCHEMA_PATH, "SCHEMA_HOST"],
      ["a flow", { flows: { "login.json": FLOW_WITH_VARIABLE } }, FLOW_PATH, "FLOW_APP"],
      [
        "a branding",
        { branding: { "brand.json": BRANDING_WITH_VARIABLE } },
        BRANDING_PATH,
        "BRAND_TITLE",
      ],
    ])(
      "refuses %s that references a variable the environment lacks",
      (_kind, documents, file, name) => {
        const config = aConfig(documents);

        const issues = environmentIssues(config, { environment: {} });

        expect(issues).toEqual([
          {
            severity: "error",
            rule: "environment/missing-variable",
            file,
            message: `references the environment variable ${name}, which is not set`,
          },
        ]);
      },
    );

    it("refuses a variable the environment sets to an empty string", () => {
      const config = aConfig({ schemas: { "staff.json": SCHEMA_WITH_VARIABLE } });

      const issues = environmentIssues(config, { environment: { SCHEMA_HOST: "" } });

      expect(issues).toMatchObject([{ rule: "environment/missing-variable", file: SCHEMA_PATH }]);
    });

    it("refuses a variable a branding template references, once the template is inlined", () => {
      const config = aConfig({
        branding: {
          "brand.json": aBranding({ liquid_template: { $file: "./brand.liquid" } }),
        },
      });
      const store = aStore(
        {},
        {
          ".zitadel/branding/brand.liquid":
            "<zl-page-shell>${TEMPLATE_VAR}{% mandatory_gates %}</zl-page-shell>",
        },
      );

      const issues = environmentIssues(config, { environment: {}, store });

      expect(issues).toMatchObject([
        { file: BRANDING_PATH, message: expect.stringContaining("TEMPLATE_VAR") },
      ]);
    });

    it.each([
      ["a schema", { schemas: { "staff.json": SCHEMA_WITH_VARIABLE } }, { SCHEMA_HOST: "x.test" }],
      ["a flow", { flows: { "login.json": FLOW_WITH_VARIABLE } }, { FLOW_APP: "app_1" }],
      [
        "a branding",
        { branding: { "brand.json": BRANDING_WITH_VARIABLE } },
        { BRAND_TITLE: "Acme" },
      ],
    ])("accepts %s whose variable the environment sets", (_kind, documents, environment) => {
      const config = aConfig(documents);

      const issues = environmentIssues(config, { environment });

      expect(issues).toEqual([]);
    });

    it("is skipped when the run knows no environment", () => {
      const config = aConfig({ schemas: { "staff.json": SCHEMA_WITH_VARIABLE } });

      const issues = environmentIssues(config, {});

      expect(issues).toEqual([]);
    });

    it("finds nothing in files that reference no variable", () => {
      const config = aConfig({ schemas: { "staff.json": aUserSchema() } });

      const issues = environmentIssues(config, { environment: {} });

      expect(issues).toEqual([]);
    });
  });
});
