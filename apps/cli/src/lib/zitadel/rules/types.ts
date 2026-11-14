/**
 * What the rules find, and what they need beyond the files.
 */

import type { FlowRuleId, FlowValidationIssue } from "@zitadel/config/validate";

import type { MethodUse } from "@/lib/zitadel/resources/flows/types";
import type { ConfigStore } from "@/lib/zitadel/storage/types";

/**
 * Every severity a finding can have: an error stops a deploy, a warning does not.
 */
export const SEVERITIES = ["error", "warning"] as const;

/**
 * How serious a finding is.
 */
export type Severity = (typeof SEVERITIES)[number];

/**
 * What some rules need beyond the files, and are skipped without.
 */
export type ValidationContext = {
  /**
   * Where branding's `$file` references are read from.
   */
  readonly store?: ConfigStore | undefined;

  /**
   * The environment a deploy runs in, which `${VAR}` references must resolve
   * against.
   */
  readonly environment?: { readonly [name: string]: string | undefined } | undefined;
};

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
  "flow/unpinned-schema",
  "sso/duplicate-slug",
  "sso/shared-variable",
  "sso/duplicate-provider",
  "sso/connection-resolves",
  "sso/flow-enables-sso",
  "sso/provider-id",
  "sso/outcome-routing",
  "sso/collection-conflict-routing",
  "sso/empty-claim-mapping",
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
 *
 * @remarks
 * The shape is what `--json` reports, so it keeps its optional keys.
 */
export type Issue = {
  /**
   * Whether the finding stops a deploy.
   */
  readonly severity: Severity;

  /**
   * The rule that found it.
   */
  readonly rule: RuleId;

  /**
   * The project-relative path of the file it is in.
   */
  readonly file: string;

  /**
   * The flow steps it is about, when it is about steps.
   *
   * @remarks
   * One issue covers every step with the same problem, so a mistake made on
   * four steps is one line to read and one fix to make.
   */
  readonly steps?: readonly string[];

  /**
   * The connection slug it is about, when it is about one.
   */
  readonly slug?: string;

  /**
   * What is wrong, and what to change.
   */
  readonly message: string;
};

/**
 * A flow rule's finding, and the flow file it is in.
 */
export type FlowIssue = {
  /**
   * The flow file's project-relative path.
   */
  readonly path: string;

  /**
   * The finding, as the server's flow rules word it.
   */
  readonly issue: FlowValidationIssue;
};

/**
 * A step that uses a method being disabled, the flow file it is in, and the
 * transitions into it that outlive the edit: those from a step that is itself
 * left with nothing go with that step.
 */
export type FlowMethodUse = MethodUse & {
  /**
   * The flow file's project-relative path.
   */
  readonly path: string;

  /**
   * The transitions into the step that outlive the edit.
   */
  readonly staying: MethodUse["targetedBy"];
};

/**
 * What a change does to one flow that runs against its schema: either the
 * flow cannot be checked, or it was, and these are the errors the change
 * brings.
 */
export type FlowCheck =
  | {
      readonly kind: "unchecked";

      /**
       * Errors the flow already has that stop the server's rules short of the
       * ones that read the schema, so whether the change breaks it cannot be told.
       */
      readonly issues: readonly FlowIssue[];
    }
  | {
      readonly kind: "checked";

      /**
       * The errors the change brings. One the flow already had is not the change's.
       */
      readonly introduced: readonly FlowIssue[];
    };
