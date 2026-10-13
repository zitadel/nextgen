/**
 * Validation for Zitadel configuration, in one library.
 *
 * Two entry points, by what they are given:
 *
 * - {@link validateFlowDefinition}: one flow, optionally with the user schema it
 *   pins. A port of the server's flow-definition validator, with the same
 *   messages, so `plan` can say what the server would say on apply and the mock
 *   server can answer the way the real one does.
 * - {@link validateProject}: the whole working tree. Rules that no single
 *   document can express, such as a flow offering a provider its schema does
 *   not list.
 *
 * `rules.ts` names every rule and what it needs. Rules that port a Go function
 * are kept honest by a drift audit; the rest are made here only, and move to
 * the server when it can see the inputs.
 */
export {
  validateFlowDefinition,
  FLOW_PURPOSES,
  PURPOSE_FLIP_TARGETS,
  RESERVED_OUTCOMES,
} from "./flow.js";
export { validateProject } from "./project.js";
export {
  FLOW_VALIDATION_RULES,
  VALIDATION_RULES,
  type FlowRuleId,
  type ProjectRuleId,
  type RuleId,
  type RuleIdOf,
  type Scope,
} from "./rules.js";
export type {
  FlowValidationIssue,
  FlowValidationSeverity,
  ProjectIssue,
  ProjectTree,
  ValidationIssue,
} from "./types.js";
