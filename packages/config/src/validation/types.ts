import type { FlowRuleId, ProjectRuleId } from "./rules.js";

export type FlowValidationSeverity = "error" | "warning";

/** A finding about one flow definition. */
export type FlowValidationIssue = {
  severity: FlowValidationSeverity;
  /** Stable rule id from {@link VALIDATION_RULES}. */
  rule: FlowRuleId;
  /** Mirrors the Go `ErrFlowDefinitionInvalid` detail string where a Go rule exists. */
  message: string;
  /** Step the issue is anchored to, when applicable. */
  step?: string;
};

/** A finding about the project as a whole. Most project rules are errors; a few are warnings. */
export type ProjectIssue = {
  severity: "error" | "warning";
  rule: ProjectRuleId;
  /** Project-relative path of the file the issue is in. */
  file: string;
  /**
   * The flow steps the issue is about, when it is about steps. One issue covers
   * every step with the same problem, so a mistake made on four steps is one
   * line to read and one fix to make.
   */
  steps?: readonly string[];
  /** The connection slug the issue is about, when it is about one. */
  slug?: string;
  message: string;
};

export type ValidationIssue = FlowValidationIssue | ProjectIssue;

/**
 * What a project-wide check reads: the whole working tree, keyed by
 * project-relative path.
 */
export type ProjectTree = {
  /** Every user schema. */
  readonly schemas: ReadonlyMap<string, object>;
  /**
   * Every flow, with the path of the schema its `user_schema` pins when that
   * could be worked out. Which schema a flow pins is the caller's to say: it
   * depends on ids the platform assigned and on what this plan re-pins. A flow
   * whose schema is unknown still gets the rules that need no schema.
   */
  readonly flows: ReadonlyMap<string, { readonly body: object; readonly schemaPath?: string }>;
  /** Every connection under `.zitadel/idps/`. */
  readonly connections: ReadonlyMap<string, object>;
  /**
   * The slugs of the connections the server already has. A deployed
   * connection's `subject_claim` can no longer change, so advice to change it
   * is not given. Absent when the caller cannot tell.
   */
  readonly deployed?: ReadonlySet<string>;
};
