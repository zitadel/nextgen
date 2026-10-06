import { validateFlowDefinition, type FlowValidationIssue } from "@zitadel/config/validate";

import { isObject } from "./json";

/**
 * The sign-in methods `auth enable` and `auth disable` switch (ADR 070).
 *
 * SSO is deliberately absent: a provider needs credentials and a connection
 * file, so it is `sso enable`'s job.
 */
export const AUTH_MODES = ["password", "passkey"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** What switching some modes did to a schema document. */
export type AuthModeChange = {
  /** The schema with the change applied; the input itself when nothing changed. */
  readonly document: Record<string, unknown>;
  /** Modes whose state this run changed. */
  readonly changed: AuthMode[];
  /** Modes that were already in the requested state. */
  readonly unchanged: AuthMode[];
};

/**
 * Set `x-auth-methods.<mode>.enabled` for each mode.
 *
 * Only `enabled` is written. Anything else under the method, and every other
 * method, belongs to whoever put it there. A mode already in the requested
 * state is reported as unchanged, so running the command twice writes nothing
 * the second time.
 */
export function setAuthModes(
  schema: Record<string, unknown>,
  modes: readonly AuthMode[],
  enabled: boolean,
): AuthModeChange {
  const existing = isObject(schema["x-auth-methods"]) ? schema["x-auth-methods"] : {};
  const methods: Record<string, unknown> = { ...existing };
  const changed: AuthMode[] = [];
  const unchanged: AuthMode[] = [];
  for (const mode of modes) {
    const entry = isObject(methods[mode]) ? methods[mode] : {};
    if ((entry.enabled === true) === enabled) {
      unchanged.push(mode);
      continue;
    }
    methods[mode] = { ...entry, enabled };
    changed.push(mode);
  }
  if (changed.length === 0) {
    return { document: schema, changed, unchanged };
  }
  return { document: { ...schema, "x-auth-methods": methods }, changed, unchanged };
}

/**
 * Every method a schema enables, SSO included, because a schema whose only
 * remaining method is a provider can still be signed in to.
 */
export function enabledSignInMethods(schema: Record<string, unknown>): string[] {
  const methods = schema["x-auth-methods"];
  if (!isObject(methods)) {
    return [];
  }
  return Object.entries(methods)
    .filter(([, value]) => isObject(value) && value.enabled === true)
    .map(([name]) => name)
    .sort();
}

/**
 * The errors a flow gains when its schema changes from `before` to `after`.
 *
 * Only new errors count. A flow that was already broken is `plan`'s to
 * report, and refusing an unrelated change because of it would block the
 * developer from the edit that might be part of the fix.
 */
export function introducedFlowErrors(
  flow: object,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FlowValidationIssue[] {
  const key = (issue: FlowValidationIssue) => `${issue.rule}\u0000${issue.message}`;
  const existing = new Set(
    validateFlowDefinition(flow, before)
      .filter((issue) => issue.severity === "error")
      .map(key),
  );
  return validateFlowDefinition(flow, after).filter(
    (issue) => issue.severity === "error" && !existing.has(key(issue)),
  );
}

/**
 * Whether a flow offers a mode to the person signing in. Password is
 * field-shaped (a step collects `x-auth-methods#password`) and passkey is
 * action-shaped (a `passkey` or `passkey_register` action), mirroring how the
 * validator tells the two apart.
 */
export function flowOffers(flow: Record<string, unknown>, mode: AuthMode): boolean {
  const steps = Array.isArray(flow.steps) ? flow.steps.filter(isObject) : [];
  if (mode === "password") {
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
