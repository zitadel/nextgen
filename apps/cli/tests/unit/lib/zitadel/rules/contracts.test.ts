import { afterEach, describe, expect, it, vi } from "vitest";

import { type Issue, UserSchema, ZitadelConfig } from "@/lib/zitadel";
import { CONTRACT_RULES } from "@/lib/zitadel/rules/contracts";

const FIRST = ".zitadel/schemas/first.json";
const SECOND = ".zitadel/schemas/second.json";

/**
 * A configuration holding two user schemas, whose findings a test decides.
 *
 * @returns The configuration.
 */
function twoSchemas(): ZitadelConfig {
  return ZitadelConfig.of({
    schemas: [
      { path: FIRST, body: {} },
      { path: SECOND, body: {} },
    ],
    flows: [],
    connections: [],
    policies: [],
    branding: [],
  });
}

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
 * Every finding the contract rules report about a configuration.
 *
 * @param config - The configuration.
 * @returns The findings, in the order reported.
 */
function reported(config: ZitadelConfig): readonly Issue[] {
  return CONTRACT_RULES.flatMap((rule) => {
    return rule.check(config, {});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CONTRACT_RULES", () => {
  it("keeps a finding under a rule no list names for the document's kind", () => {
    vi.spyOn(UserSchema.prototype, "check").mockReturnValue([
      finding("sso/duplicate-provider", FIRST),
    ]);

    expect(reported(twoSchemas())).toContainEqual(finding("sso/duplicate-provider", FIRST));
  });

  it("reports one mistake made in several files as one run of lines", () => {
    vi.spyOn(UserSchema.prototype, "check").mockImplementation(function (this: UserSchema) {
      return [finding("contract/schema", this.path), finding("sso/duplicate-provider", this.path)];
    });

    expect(reported(twoSchemas())).toEqual([
      finding("contract/schema", FIRST),
      finding("contract/schema", SECOND),
      finding("sso/duplicate-provider", FIRST),
      finding("sso/duplicate-provider", SECOND),
    ]);
  });
});
