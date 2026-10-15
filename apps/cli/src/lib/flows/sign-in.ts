import { flowConfigSchema } from "@zitadel/config/schemas";
import {
  PURPOSE_FLIP_TARGETS,
  validateFlowDefinition,
  type FlowValidationIssue,
} from "@zitadel/config/validate";

import { isObject } from "../json";

/** What validating a flow against a schema change found. */
type FlowCheck =
  /**
   * The flow has a structural error, so the validator never reached the rules
   * that depend on the schema and cannot say whether the change breaks it.
   */
  | { readonly kind: "unchecked"; readonly issues: FlowValidationIssue[] }
  /** The errors the change introduces; empty when the flow is unaffected. */
  | { readonly kind: "checked"; readonly introduced: FlowValidationIssue[] };

/**
 * Check what a schema change from `before` to `after` does to a flow.
 *
 * Only new errors count. A schema-rule error the flow already had is `plan`'s
 * to report, and refusing an unrelated change because of it would block the
 * developer from an edit that might be part of the fix.
 *
 * @param flow - The flow as it is on disk.
 * @param before - The schema as it is on disk.
 * @param after - The schema as the change leaves it.
 * @param flowAfter - The flow as the change leaves it. Password and passkey
 *   never edit a flow, so it defaults to the flow itself; `auth-method sso
 *   disable` removes the provider from it.
 */
export function checkFlow(
  flow: object,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  flowAfter: object = flow,
): FlowCheck {
  // The semantic validator reads a malformed shape leniently (a string where
  // `fields` should be a list reads as no fields), so the raw file is checked
  // against the canonical flow schema first, as `plan` does.
  const shape = flowConfigSchema.safeParse(flowAfter);
  if (!shape.success) {
    return {
      kind: "unchecked",
      issues: shape.error.issues.map((issue) => ({
        severity: "error",
        rule: "definition",
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      })),
    };
  }
  // The validator runs the schema rules only over a structurally sound flow,
  // so without this the change would always look harmless on a broken one.
  const structural = validateFlowDefinition(flowAfter);
  if (structural.length > 0) {
    return { kind: "unchecked", issues: structural };
  }
  const key = (issue: FlowValidationIssue) => `${issue.rule}\u0000${issue.message}`;
  const existing = new Set(
    validateFlowDefinition(flow, before)
      .filter((issue) => issue.severity === "error")
      .map(key),
  );
  return {
    kind: "checked",
    introduced: validateFlowDefinition(flowAfter, after).filter(
      (issue) => issue.severity === "error" && !existing.has(key(issue)),
    ),
  };
}

/**
 * The sign-in methods (`password`, `passkey`, `sso`) that some active flow
 * lets an existing user sign in with.
 *
 * Only an active flow is served, so a draft offers nothing. Passkey counts
 * only through a `passkey` action: `passkey_register` enrols a new credential
 * and signs nobody in. SSO counts only through a step offering one of
 * `providers`.
 *
 * @param flows - The flows that run against the schema, whatever their status.
 * @param providers - The SSO providers the schema enables.
 */
export function offeredSignInMethods(
  flows: readonly Record<string, unknown>[],
  providers: readonly string[],
): string[] {
  // Only the login journey signs anyone in: a register-only flow, or the
  // register steps of a combined one, can collect a password or offer a
  // passkey without letting an existing user back in.
  const journeys = flows.filter((flow) => flow.status === "active").map(loginJourney);
  const offered = (signsIn: (flow: Record<string, unknown>) => boolean) => journeys.some(signsIn);
  return [
    ...(offered(collectsPassword) ? ["password"] : []),
    ...(offered(signsInWithPasskey) ? ["passkey"] : []),
    ...(offered((flow) => offersSso(flow, providers)) ? ["sso"] : []),
  ];
}

/**
 * Outcomes the engine answers by switching from login to register without a
 * `purpose` on the transition: the validator's flip table, plus
 * `sso_user_not_found`, which it leaves out of that table on purpose but
 * which routes to registration the same way.
 */
const LOGIN_LEAVING_OUTCOMES = new Set([
  ...Object.keys(PURPOSE_FLIP_TARGETS.login ?? {}),
  "sso_user_not_found",
]);

/**
 * The flow cut down to the steps reachable from its `login` entry, following
 * transitions that stay in the login purpose. No `login` purpose means no
 * steps: such a flow signs nobody in.
 */
function loginJourney(flow: Record<string, unknown>): Record<string, unknown> {
  const purposes = isObject(flow.purposes) ? flow.purposes : {};
  const entry = purposes.login;
  const byName = new Map(steps(flow).map((step) => [step.name, step]));
  const reached = new Set<string>();
  const queue = typeof entry === "string" ? [entry] : [];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const step = byName.get(name);
    if (reached.has(name) || step === undefined) {
      continue;
    }
    reached.add(name);
    const transitions = isObject(step.transitions) ? Object.entries(step.transitions) : [];
    for (const [outcome, transition] of transitions) {
      // Some outcomes switch the journey to registration on their own, with
      // no `purpose` on the transition: the steps after them register a new
      // user rather than sign one in.
      if (LOGIN_LEAVING_OUTCOMES.has(outcome)) {
        continue;
      }
      // Mirrors the validator's local adjacency: a transition with an
      // `action` goes to another flow, whose step names are not this flow's,
      // and one into another purpose (register, say) leaves the login
      // journey. A null `action` or `purpose` is the same as an absent one.
      if (
        isObject(transition) &&
        typeof transition.target === "string" &&
        (transition.action === undefined || transition.action === null) &&
        (transition.purpose === undefined ||
          transition.purpose === null ||
          transition.purpose === "login")
      ) {
        queue.push(transition.target);
      }
    }
  }
  return { ...flow, steps: steps(flow).filter((step) => reached.has(step.name as string)) };
}

function steps(flow: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(flow.steps) ? flow.steps.filter(isObject) : [];
}

/** Password is field-shaped: a step collects `x-auth-methods#password`. */
function collectsPassword(flow: Record<string, unknown>): boolean {
  return steps(flow).some(
    (step) => Array.isArray(step.fields) && step.fields.includes("x-auth-methods#password"),
  );
}

function signsInWithPasskey(flow: Record<string, unknown>): boolean {
  return steps(flow).some(
    (step) =>
      Array.isArray(step.actions) &&
      step.actions.some((action) => isObject(action) && action.kind === "passkey"),
  );
}

function offersSso(flow: Record<string, unknown>, providers: readonly string[]): boolean {
  return steps(flow).some(
    (step) =>
      Array.isArray(step.sso_providers) &&
      step.sso_providers.some((p) => typeof p === "string" && providers.includes(p)),
  );
}
