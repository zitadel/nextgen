import type { FlowValidationIssue } from "@zitadel/config/validate";

import { ZitadelError } from "./errors";
import { checkFlow, offeredSignInMethods } from "./flows";
import { type FlowFile, methodsOf, type SchemaFile } from "./idp";
import { isObject } from "./json";

/**
 * The methods `auth-method password` and `auth-method passkey` switch on and
 * off by a flag alone (ADR 069).
 *
 * SSO is not one of them: a provider needs credentials, a connection file and
 * flow edits, so `auth-method sso` handles it with its own commands.
 */
export const TOGGLEABLE_METHODS = ["password", "passkey"] as const;
export type ToggleableMethod = (typeof TOGGLEABLE_METHODS)[number];

/**
 * Set `x-auth-methods.<method>.enabled` on a schema document.
 *
 * Only `enabled` is written. Anything else under the method, and every other
 * method, belongs to whoever put it there. A method already in the requested
 * state is reported as unchanged and the input returned as it is, so running
 * the command twice writes nothing the second time.
 *
 * @param schema - The schema document, which is not mutated.
 * @param method - The method to switch.
 * @param enabled - The state to put it in.
 */
export function setMethodEnabled(
  schema: Record<string, unknown>,
  method: ToggleableMethod,
  enabled: boolean,
): { readonly document: Record<string, unknown>; readonly changed: boolean } {
  const existing = isObject(schema["x-auth-methods"]) ? schema["x-auth-methods"] : {};
  const entry = isObject(existing[method]) ? existing[method] : {};
  if ((entry.enabled === true) === enabled) {
    return { document: schema, changed: false };
  }
  return {
    document: { ...schema, "x-auth-methods": { ...existing, [method]: { ...entry, enabled } } },
    changed: true,
  };
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
  return methodsOf(schema).filter((method) =>
    method === "sso"
      ? enabledProviders(schema).length > 0
      : (TOGGLEABLE_METHODS as readonly string[]).includes(method),
  );
}

/**
 * Every string a schema lists under `x-auth-methods.sso.providers`, as
 * written. Some may be no way to sign in at all (see
 * {@link usableSignInMethods}); this is what the schema says, for a hint that
 * names what the developer can remove.
 */
export function listedProviders(schema: Record<string, unknown>): string[] {
  const methods = schema["x-auth-methods"];
  const sso = isObject(methods) ? methods.sso : undefined;
  return isObject(sso) && Array.isArray(sso.providers)
    ? sso.providers.filter((p): p is string => typeof p === "string")
    : [];
}

/** The provider slug format the SSO auth-method meta-schema allows. */
const PROVIDER_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The listed providers that are well-formed slugs: an entry like `Not A Slug`
 * names no connection, so it is no way to sign in.
 */
function enabledProviders(schema: Record<string, unknown>): string[] {
  return listedProviders(schema).filter((p) => p.length <= 64 && PROVIDER_SLUG.test(p));
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

/**
 * The methods a schema enables that some active flow lets an existing user
 * sign in with. SSO counts only through a step offering a provider the schema
 * itself enables.
 *
 * @param schema - The schema document.
 * @param flows - The flows that run against it, whatever their status: only
 *   the active ones count.
 */
export function reachableSignInMethods(
  schema: Record<string, unknown>,
  flows: readonly Record<string, unknown>[],
): string[] {
  const offered = offeredSignInMethods(flows, enabledProviders(schema));
  return usableSignInMethods(schema).filter((method) => offered.includes(method));
}

/**
 * Why the schema's `x-auth-methods` cannot be edited safely for one method, or
 * `undefined` when it can. Only an absent container or entry counts as empty:
 * a value of the wrong shape was written by someone, and rewriting it would
 * discard it.
 */
export function malformedAuthMethods(
  schema: Record<string, unknown>,
  method: ToggleableMethod,
): string | undefined {
  const methods = schema["x-auth-methods"];
  if (methods === undefined) {
    return undefined;
  }
  if (!isObject(methods)) {
    return "x-auth-methods is not an object";
  }
  const entry = methods[method];
  if (entry === undefined) {
    return undefined;
  }
  if (!isObject(entry)) {
    return `x-auth-methods.${method} is not an object`;
  }
  // The meta-schema requires a boolean. A missing one or a string "true" is
  // neither on nor off, so it is refused rather than overwritten or read as
  // disabled.
  if (typeof entry.enabled !== "boolean") {
    return `x-auth-methods.${method}.enabled is not a boolean`;
  }
  return undefined;
}

/**
 * Refuse to edit a file whose region is not the shape the command edits.
 * Rewriting it would discard whatever a developer put there, so the run stops
 * before anything is written or published.
 *
 * @param path - The project-relative file the region is in.
 * @param region - What is wrong with it, or `undefined` when nothing is, in
 *   which case this returns.
 */
export function refuseUneditable(path: string, region: string | undefined): void {
  if (region === undefined) {
    return;
  }
  throw new ZitadelError("E_VALIDATION", `${path}: ${region}`, {
    hint:
      "This command edits that region, and it is not the shape it edits. " +
      "Fix it against the dialect in .zitadel/meta/, then run the command again.",
    details: { file: path, region },
  });
}

/**
 * Refuse when a flow running against the schema would stop validating once
 * the schema and the flows are changed, or cannot be checked at all. `plan`
 * would reject either, so the change is refused before it is written.
 *
 * @param schema - The schema being changed.
 * @param after - The schema as the change leaves it.
 * @param flows - Each flow that runs against the schema, with its body as the
 *   change leaves it.
 * @param introduced - What to say about errors the change introduces. Neutral
 *   by default; a command that leaves flows alone says which method is still
 *   used instead.
 */
export function refuseBrokenFlows(
  schema: SchemaFile,
  after: Record<string, unknown>,
  flows: ReadonlyArray<{ readonly file: FlowFile; readonly after: Record<string, unknown> }>,
  introduced: { heading: string; hint: string } = {
    heading: "A login flow would stop validating after this change:",
    hint: "Fix the steps named above, then run the command again.",
  },
): void {
  const unchecked: FlowIssue[] = [];
  const added: FlowIssue[] = [];
  for (const { file, after: flowAfter } of flows) {
    const check = checkFlow(file.body, schema.body, after, flowAfter);
    if (check.kind === "unchecked") {
      unchecked.push(...check.issues.map((issue) => ({ path: file.path, issue })));
    } else {
      added.push(...check.introduced.map((issue) => ({ path: file.path, issue })));
    }
  }
  if (unchecked.length > 0) {
    throw brokenFlowsError(
      schema.path,
      unchecked,
      "A login flow has errors, so it cannot be checked against the changed schema:",
      "Fix those errors first (`zitadel plan` reports them too), then run the command again.",
    );
  }
  if (added.length > 0) {
    throw brokenFlowsError(schema.path, added, introduced.heading, introduced.hint);
  }
}

/** A validation issue and the flow file it was found in. */
type FlowIssue = { readonly path: string; readonly issue: FlowValidationIssue };

function brokenFlowsError(
  file: string,
  issues: readonly FlowIssue[],
  heading: string,
  hint: string,
): ZitadelError {
  return new ZitadelError(
    "E_VALIDATION",
    `${heading}\n${issues.map(({ path, issue }) => `  - ${path}: ${issue.message}`).join("\n")}`,
    {
      hint,
      details: {
        file,
        issues: issues.map(({ path, issue }) => ({
          path,
          rule: issue.rule,
          message: issue.message,
          ...(issue.step === undefined ? {} : { step: issue.step }),
        })),
      },
    },
  );
}
