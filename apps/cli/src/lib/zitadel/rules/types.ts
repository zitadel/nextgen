/**
 * What the rules find, and what they need beyond the files.
 */

import type { FlowRuleId, FlowValidationIssue } from "@zitadel/config/validate";

import type { MethodUse } from "@/lib/zitadel/resources/flows/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";

/**
 * How serious a finding is: an error stops a deploy, a warning does not.
 */
export type Severity = "error" | "warning";

/**
 * What some rules need beyond the files, and are skipped without.
 */
export type ValidationContext = Readonly<{
  /**
   * Where branding's `$file` references are read from.
   */
  store?: ConfigStore | undefined;
  /**
   * The environment a deploy runs in, which `${VAR}` references must resolve
   * against.
   */
  environment?: Readonly<Record<string, string | undefined>> | undefined;
}>;

/**
 * Every rule this library makes.
 *
 * @remarks
 * A flow is also held to the server's own flow rules, whose ids
 * {@link RuleId} adds.
 */
export const RULE_IDS = [
  "contract/schema",
  "contract/flow",
  "contract/connection",
  "contract/policy",
  "contract/branding",
  "connection/literal-secret",
  "connection/endpoints",
  "branding/legacy-template-key",
  "branding/template-file",
  "branding/template",
  "environment/missing-variable",
  "sso/duplicate-slug",
  "sso/shared-variable",
  "sso/duplicate-provider",
  "sso/connection-resolves",
  "sso/flow-enables-sso",
  "sso/provider-id",
  "sso/outcome-routing",
  "sso/collection-conflict-routing",
  "sso/empty-claim-mapping",
  "sso/collection-misses-required",
  "sso/unknown-connection-field",
  "sso/unmapped-verification-key",
  "sso/claim-needs-scope",
  "sso/verification-source-not-boolean",
  "sso/claim-name-whitespace",
  "sso/subject-claim-unstable",
  "sso/claim-type-mismatch",
  "sso/orphaned-mapping-target",
  "sso/orphaned-verification-key",
] as const;

/**
 * One rule's id: this library's, or one of the server's flow rules.
 */
export type RuleId = (typeof RULE_IDS)[number] | FlowRuleId;

/**
 * A finding: what is wrong, where, and what to change.
 */
export type Issue = Readonly<{
  /**
   * Whether the finding stops a deploy.
   */
  severity: Severity;
  /**
   * The rule that found it.
   */
  rule: RuleId;
  /**
   * The project-relative path of the file it is in.
   */
  file: string;
  /**
   * The flow steps it is about, when it is about steps.
   *
   * @remarks
   * One issue covers every step with the same problem, so a mistake made on
   * four steps is one line to read and one fix to make.
   */
  steps?: readonly string[];
  /**
   * The connection slug it is about, when it is about one.
   */
  slug?: string;
  /**
   * What is wrong, and what to change.
   */
  message: string;
}>;

/**
 * A flow rule's finding, and the flow file it is in.
 */
export type FlowIssue = Readonly<{
  /**
   * The flow file's project-relative path.
   */
  path: string;
  /**
   * The finding, as the server's flow rules word it.
   */
  issue: FlowValidationIssue;
}>;

/**
 * A step that uses a method being disabled, the flow file it is in, and the
 * transitions into it that outlive the edit: those from a step that is itself
 * left with nothing go with that step.
 */
export type FlowMethodUse = MethodUse &
  Readonly<{
    /**
     * The flow file's project-relative path.
     */
    path: string;
    /**
     * The transitions into the step that outlive the edit.
     */
    staying: MethodUse["targetedBy"];
  }>;

/**
 * What a change does to the flows that run against its schema.
 */
export type FlowCheck = Readonly<{
  /**
   * Errors a flow already has that stop the server's rules short of the ones
   * that read the schema, so whether the change breaks it cannot be told.
   */
  unchecked: readonly FlowIssue[];
  /**
   * The errors the change brings. One a flow already had is not the change's.
   */
  introduced: readonly FlowIssue[];
}>;
