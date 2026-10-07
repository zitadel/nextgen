import { validateFlowDefinition, type FlowValidationIssue } from "@zitadel/config/validate";

import { isObject } from "./json";

/**
 * The factors `auth-factor enable` and `auth-factor disable` switch (ADR 068).
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
  const sso = methods.sso;
  if (on("sso") && isObject(sso) && Array.isArray(sso.providers) && sso.providers.length > 0) {
    usable.push("sso");
  }
  return usable.sort();
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
 * The methods a schema enables that some active flow also offers: the ways a
 * user can actually sign in. SSO is offered by a step that names a provider.
 */
export function reachableSignInMethods(
  schema: Record<string, unknown>,
  activeFlows: readonly Record<string, unknown>[],
): string[] {
  return usableSignInMethods(schema).filter((method) =>
    activeFlows.some((flow) =>
      method === "sso" ? offersSso(flow) : flowOffers(flow, method as AuthFactor),
    ),
  );
}

function offersSso(flow: Record<string, unknown>): boolean {
  const steps = Array.isArray(flow.steps) ? flow.steps.filter(isObject) : [];
  return steps.some((step) => Array.isArray(step.sso_providers) && step.sso_providers.length > 0);
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
    // The meta-schema requires a boolean. A string "true" is neither on nor
    // off, so it is refused rather than overwritten or read as disabled.
    if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") {
      return `x-auth-methods.${factor}.enabled is not a boolean`;
    }
  }
  return undefined;
}
