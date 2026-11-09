import { describe, expect, it, vi } from "vitest";

import { type Issue, UserSchema } from "@/lib/zitadel";
import { CONTRACT_RULES } from "@/lib/zitadel/rules/contracts";
import { aConfig, aUserSchema } from "@tests/helpers/config";

/**
 * Where the first of the schemas sits.
 */
const FIRST = ".zitadel/schemas/first.json";

/**
 * Where the second of the schemas sits.
 */
const SECOND = ".zitadel/schemas/second.json";

/**
 * Where the third of the schemas sits.
 */
const THIRD = ".zitadel/schemas/third.json";

/**
 * Two sound user schemas, whose findings a test decides.
 */
const TWO_SCHEMAS = {
  schemas: { "first.json": aUserSchema(), "second.json": aUserSchema() },
};

/**
 * A broken schema between two sound ones, given out of path order; its
 * findings are all `contract/schema` ones.
 */
const BROKEN_BETWEEN = {
  schemas: { "third.json": aUserSchema(), "second.json": {}, "first.json": aUserSchema() },
};

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

/**
 * Run every contract rule.
 *
 * @param config - The configuration to check.
 * @returns Every finding, in the order the rules report them.
 */
function contractIssues(config: ReturnType<typeof aConfig>): readonly Issue[] {
  return CONTRACT_RULES.flatMap((rule) => {
    return rule.check(config, {});
  });
}

/**
 * Every finding the broken files of a configuration carry.
 *
 * @param config - The configuration.
 * @returns The findings, file by file.
 */
function brokenIssues(config: ReturnType<typeof aConfig>): readonly Issue[] {
  return config.broken.flatMap((file) => {
    return file.issues;
  });
}

describe("CONTRACT_RULES", () => {
  it("keeps a finding under a rule no list names for the document's kind", () => {
    const config = aConfig(TWO_SCHEMAS);
    vi.spyOn(UserSchema.prototype, "check").mockReturnValue([
      finding("sso/duplicate-provider", FIRST),
    ]);

    const issues = contractIssues(config);

    expect(issues).toContainEqual(finding("sso/duplicate-provider", FIRST));
  });

  it("reports one mistake made in several files as one run of lines", () => {
    const config = aConfig(TWO_SCHEMAS);
    vi.spyOn(UserSchema.prototype, "check").mockImplementation(function (this: UserSchema) {
      return [finding("contract/schema", this.path), finding("sso/duplicate-provider", this.path)];
    });

    const issues = contractIssues(config);

    expect(issues).toEqual([
      finding("contract/schema", FIRST),
      finding("contract/schema", SECOND),
      finding("sso/duplicate-provider", FIRST),
      finding("sso/duplicate-provider", SECOND),
    ]);
  });

  it("reports a broken file's own findings", () => {
    const config = aConfig({ schemas: { "second.json": {} } });
    const broken = brokenIssues(config);

    const issues = contractIssues(config);

    expect(issues).toEqual(broken);
  });

  it("reports a broken file where its path falls among the documents", () => {
    const config = aConfig(BROKEN_BETWEEN);
    const broken = brokenIssues(config);
    vi.spyOn(UserSchema.prototype, "check").mockImplementation(function (this: UserSchema) {
      return [finding("contract/schema", this.path)];
    });

    const issues = contractIssues(config);

    expect(issues).toEqual([
      finding("contract/schema", FIRST),
      ...broken,
      finding("contract/schema", THIRD),
    ]);
  });

  it("orders paths by code unit, whatever the host's locale", () => {
    const config = aConfig({
      schemas: { "B.json": aUserSchema(), "a_b.json": aUserSchema(), "a-b.json": aUserSchema() },
    });
    vi.spyOn(UserSchema.prototype, "check").mockImplementation(function (this: UserSchema) {
      return [finding("contract/schema", this.path)];
    });

    const issues = contractIssues(config);

    expect(
      issues.map((issue) => {
        return issue.file;
      }),
    ).toEqual([
      ".zitadel/schemas/B.json",
      ".zitadel/schemas/a-b.json",
      ".zitadel/schemas/a_b.json",
    ]);
  });
});
