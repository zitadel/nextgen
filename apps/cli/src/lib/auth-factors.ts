import { flowConfigSchema } from "@zitadel/config/schemas";
import {
  PURPOSE_FLIP_TARGETS,
  validateFlowDefinition,
  type FlowValidationIssue,
} from "@zitadel/config/validate";

import { isObject } from "./json";

/**
 * The factors `auth-factor enable` and `auth-factor disable` switch (ADR 069).
 *
 * SSO is deliberately absent: a provider needs credentials and a connection
 * file, so it is `sso enable`'s job.
 */
export const AUTH_FACTORS = ["password", "passkey"] as const;
export type AuthFactor = (typeof AUTH_FACTORS)[number];

/** What switching some factors did to a schema document. */
export type AuthFactorChange = {
  /** The schema with the change applied; the input itself when nothing changed. */
  readonly document: Record<string, unknown>;
  /** Factors whose state this run changed. */
  readonly changed: AuthFactor[];
  /** Factors that were already in the requested state. */
  readonly unchanged: AuthFactor[];
};

/**
 * Set `x-auth-methods.<factor>.enabled` for each factor.
 *
 * Only `enabled` is written. Anything else under the method, and every other
 * method, belongs to whoever put it there. A factor already in the requested
 * state is reported as unchanged, so running the command twice writes nothing
 * the second time.
 */
export function setAuthFactors(
  schema: Record<string, unknown>,
  factors: readonly AuthFactor[],
  enabled: boolean,
): AuthFactorChange {
  const existing = isObject(schema["x-auth-methods"]) ? schema["x-auth-methods"] : {};
  const methods: Record<string, unknown> = { ...existing };
  const changed: AuthFactor[] = [];
  const unchanged: AuthFactor[] = [];
  for (const factor of factors) {
    const entry = isObject(methods[factor]) ? methods[factor] : {};
    if ((entry.enabled === true) === enabled) {
      unchanged.push(factor);
      continue;
    }
    methods[factor] = { ...entry, enabled };
    changed.push(factor);
  }
  if (changed.length === 0) {
    return { document: schema, changed, unchanged };
  }
  return { document: { ...schema, "x-auth-methods": methods }, changed, unchanged };
}

/**
 * The ways a schema's users can actually sign in.
 *
 * Only what the login engine serves counts: password, passkey, and SSO with at
 * least one provider. The meta-schema also accepts `otp` and `magic_link`, but
 * nothing in a flow can use them yet, so a schema left with only those has no
 * way in.
 */
export function usableSignInMethods(schema: Record<string, unknown>): string[] {
  const methods = schema["x-auth-methods"];
  if (!isObject(methods)) {
    return [];
  }
  const on = (name: string) => isObject(methods[name]) && methods[name].enabled === true;
  const usable: string[] = AUTH_FACTORS.filter(on);
  if (on("sso") && enabledProviders(schema).length > 0) {
    usable.push("sso");
  }
  return usable.sort();
}

/** The provider slug format the SSO auth-method meta-schema allows. */
const PROVIDER_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The SSO providers the schema enables, keeping only well-formed slugs: an
 * entry like `7` names no connection, so it is no way to sign in.
 */
function enabledProviders(schema: Record<string, unknown>): string[] {
  const methods = schema["x-auth-methods"];
  const sso = isObject(methods) ? methods.sso : undefined;
  return isObject(sso) && Array.isArray(sso.providers)
    ? sso.providers.filter(
        (p): p is string => typeof p === "string" && p.length <= 64 && PROVIDER_SLUG.test(p),
      )
    : [];
}

/**
 * Whether the schema names the property that identifies a user. The server
 * refuses a schema that enables password without one, because a password is
 * checked against a user found by that property.
 */
export function hasIdentifier(schema: Record<string, unknown>): boolean {
  const identifier = schema["x-identifier"];
  return typeof identifier === "string" && identifier.trim() !== "";
}

/** What validating a flow against a schema change found. */
export type FlowCheck =
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
 */
export function checkFlow(
  flow: object,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FlowCheck {
  // The semantic validator reads a malformed shape leniently (a string where
  // `fields` should be a list reads as no fields), so the raw file is checked
  // against the canonical flow schema first, as `plan` does.
  const shape = flowConfigSchema.safeParse(flow);
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
  const structural = validateFlowDefinition(flow);
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
    introduced: validateFlowDefinition(flow, after).filter(
      (issue) => issue.severity === "error" && !existing.has(key(issue)),
    ),
  };
}

/**
 * Whether a flow offers a factor to the person signing in. Password is
 * field-shaped (a step collects `x-auth-methods#password`) and passkey is
 * action-shaped (a `passkey` or `passkey_register` action), mirroring how the
 * validator tells the two apart.
 */
export function flowOffers(flow: Record<string, unknown>, factor: AuthFactor): boolean {
  const steps = Array.isArray(flow.steps) ? flow.steps.filter(isObject) : [];
  if (factor === "password") {
    return steps.some(
      (step) => Array.isArray(step.fields) && step.fields.includes("x-auth-methods#password"),
    );
  }
  return steps.some(
    (step) =>
      Array.isArray(step.actions) &&
      step.actions.some(
        (action) =>
          isObject(action) && (action.kind === "passkey" || action.kind === "passkey_register"),
      ),
  );
}

/**
 * The methods a schema enables that some active flow lets an existing user
 * sign in with. Passkey counts only through a `passkey` action:
 * `passkey_register` enrols a new credential and signs nobody in. SSO counts
 * only through a step offering a provider the schema itself enables.
 */
export function reachableSignInMethods(
  schema: Record<string, unknown>,
  activeFlows: readonly Record<string, unknown>[],
): string[] {
  // Only the login journey signs anyone in: a register-only flow, or the
  // register steps of a combined one, can collect a password or offer a
  // passkey without letting an existing user back in.
  const loginFlows = activeFlows.map(loginJourney);
  return usableSignInMethods(schema).filter((method) =>
    loginFlows.some((flow) =>
      method === "sso"
        ? offersSso(flow, enabledProviders(schema))
        : method === "passkey"
          ? signsInWithPasskey(flow)
          : flowOffers(flow, method as AuthFactor),
    ),
  );
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

/**
 * Why the schema's `x-auth-methods` cannot be edited safely, or `undefined`
 * when it can. Only an absent container or entry counts as empty: a value of
 * the wrong shape was written by someone, and rewriting it would discard it.
 */
export function malformedAuthMethods(
  schema: Record<string, unknown>,
  factors: readonly AuthFactor[],
): string | undefined {
  const methods = schema["x-auth-methods"];
  if (methods === undefined) {
    return undefined;
  }
  if (!isObject(methods)) {
    return "x-auth-methods is not an object";
  }
  for (const factor of factors) {
    const entry = methods[factor];
    if (entry === undefined) {
      continue;
    }
    if (!isObject(entry)) {
      return `x-auth-methods.${factor} is not an object`;
    }
    // The meta-schema requires a boolean. A missing one or a string "true" is
    // neither on nor off, so it is refused rather than overwritten or read as
    // disabled. Only an absent entry counts as empty.
    if (typeof entry.enabled !== "boolean") {
      return `x-auth-methods.${factor}.enabled is not a boolean`;
    }
  }
  return undefined;
}
