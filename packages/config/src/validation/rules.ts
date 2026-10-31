/**
 * Every validation rule, in one place.
 *
 * A rule is named once here, with what it needs to run (`scope`) and which Go
 * function it ports (`goRef`, or `null` for a rule only this library makes).
 * Everything else is derived from this table: the rule ids the issues may
 * carry, the subset each entry point can emit, and the drift audit against the
 * Go source. A rule that is not listed cannot be reported, and one that is
 * listed cannot be reported from an entry point that lacks its inputs, because
 * the types say so.
 *
 * Scopes, by what a rule reads:
 *
 * - `flow`: one flow definition on its own.
 * - `flow-schema`: one flow and the user schema it pins.
 * - `project`: the whole working tree — every schema, flow and connection file.
 */
export type Scope = "flow" | "flow-schema" | "project";

type RuleSpec = {
  readonly scope: Scope;
  /** The Go function this rule ports, or `null` when the server has no counterpart. */
  readonly goRef: string | null;
};

export const VALIDATION_RULES = {
  // Flow definition, on its own.
  "step-names": { scope: "flow", goRef: "stepNamesMap" },
  definition: { scope: "flow", goRef: "validateDefinition" },
  steps: { scope: "flow", goRef: "validateSteps" },
  graph: { scope: "flow", goRef: "validateGraph" },
  cycles: { scope: "flow", goRef: "validateCycles" },
  "flip-table": { scope: "flow", goRef: "validateFlipTableCoverage" },

  // Flow definition against the schema it pins.
  "schema/required-fields": { scope: "flow-schema", goRef: "validateRequiredUserSchemaFields" },
  "schema/fields-resolve": { scope: "flow-schema", goRef: "resolveAllStepFields" },
  "schema/passkey-actions": { scope: "flow-schema", goRef: "validatePasskeyActionsEnabled" },
  "schema/on-success-manifest": { scope: "flow-schema", goRef: "validateOnSuccessManifests" },
  "warn/password-without-identifier": { scope: "flow-schema", goRef: null },

  // SSO across schemas, flows and connection files. Only the CLI holds the
  // whole tree, so none has a server counterpart yet; #1014 is the server side
  // of the ones that need no more than a flow and its schema.
  "sso/flow-enables-sso": { scope: "project", goRef: null },
  "sso/provider-id": { scope: "project", goRef: null },
  "sso/connection-resolves": { scope: "project", goRef: null },
  "sso/duplicate-slug": { scope: "project", goRef: null },
  "sso/shared-variable": { scope: "project", goRef: null },
  "sso/outcome-routing": { scope: "project", goRef: null },
  "sso/collection-conflict-routing": { scope: "project", goRef: null },
  "sso/empty-claim-mapping": { scope: "project", goRef: null },
  "sso/unmapped-verification-key": { scope: "project", goRef: null },
  "sso/orphaned-mapping-target": { scope: "project", goRef: null },
  "sso/orphaned-verification-key": { scope: "project", goRef: null },
  "sso/collection-misses-required": { scope: "project", goRef: null },
  "sso/claim-needs-scope": { scope: "project", goRef: null },
  "sso/duplicate-provider": { scope: "project", goRef: null },
  "sso/unknown-connection-field": { scope: "project", goRef: null },
  "sso/claim-name-whitespace": { scope: "project", goRef: null },
  "sso/subject-claim-unstable": { scope: "project", goRef: null },
  "sso/claim-type-mismatch": { scope: "project", goRef: null },
  "sso/verification-source-not-boolean": { scope: "project", goRef: null },
} as const satisfies Record<string, RuleSpec>;

export type RuleId = keyof typeof VALIDATION_RULES;

/** The ids of the rules whose scope is one of `S`. */
export type RuleIdOf<S extends Scope> = {
  [K in RuleId]: (typeof VALIDATION_RULES)[K]["scope"] extends S ? K : never;
}[RuleId];

/** What `validateFlowDefinition` can report. */
export type FlowRuleId = RuleIdOf<"flow" | "flow-schema">;

/** What `validateProject` can report. */
export type ProjectRuleId = RuleIdOf<"project">;

/**
 * The rules that run over a single flow, each with the Go function it ports.
 * The drift audit walks this to prove those functions still exist.
 */
export const FLOW_VALIDATION_RULES = Object.fromEntries(
  Object.entries(VALIDATION_RULES).filter(([, spec]) => spec.scope !== "project"),
) as { [K in FlowRuleId]: (typeof VALIDATION_RULES)[K] };
