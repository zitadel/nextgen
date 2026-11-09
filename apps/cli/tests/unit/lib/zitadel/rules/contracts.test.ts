import { describe, expect, it, vi } from "vitest";

import { type Issue, UserSchema } from "@/lib/zitadel";
import { CONTRACT_RULES } from "@/lib/zitadel/rules/contracts";
import { aConfig } from "@tests/helpers/config";

/**
 * Where the first of the two schemas sits.
 */
const FIRST = ".zitadel/schemas/first.json";

/**
 * Where the second of the two schemas sits.
 */
const SECOND = ".zitadel/schemas/second.json";

/**
 * Two user schemas, whose findings a test decides.
 */
const TWO_SCHEMAS = { schemas: { "first.json": {}, "second.json": {} } };

/**
 * An error-level finding about a file.
 *
 * @param rule - The rule it breaks.
 * @param file - The file it is in.
 * @returns The finding.
 */
function finding(rule: Issue["rule"], file: string): Issue {
  return { severity: "error", rule, file, message: `${rule} in ${file}` };
}

describe("CONTRACT_RULES", () => {
  it("keeps a finding under a rule no list names for the document's kind", () => {
    const config = aConfig(TWO_SCHEMAS);
    vi.spyOn(UserSchema.prototype, "problems").mockReturnValue([
      finding("sso/duplicate-provider", FIRST),
    ]);

    const issues = CONTRACT_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toContainEqual(finding("sso/duplicate-provider", FIRST));
  });

  it("reports one mistake made in several files as one run of lines", () => {
    const config = aConfig(TWO_SCHEMAS);
    vi.spyOn(UserSchema.prototype, "problems").mockImplementation(function (this: UserSchema) {
      return [finding("contract/schema", this.path), finding("sso/duplicate-provider", this.path)];
    });

    const issues = CONTRACT_RULES.flatMap((rule) => {
      return rule.check(config, {});
    });

    expect(issues).toEqual([
      finding("contract/schema", FIRST),
      finding("contract/schema", SECOND),
      finding("sso/duplicate-provider", FIRST),
      finding("sso/duplicate-provider", SECOND),
    ]);
  });
});
