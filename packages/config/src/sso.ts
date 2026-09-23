/**
 * Enabling a provider on an existing Project edits two files: the user schema
 * gains an `sso` authentication method, and the login flow gains the steps and
 * routes a provider round trip needs.
 *
 * Both functions are pure — they take parsed documents and return new ones, so
 * the caller owns reading, writing and reporting. Both are idempotent: running
 * them again on their own output changes nothing.
 *
 * Only the regions below are ever written. Anything a developer has edited by
 * hand is left exactly as it stands and reported back, because silently
 * rewriting it would discard deliberate work.
 */

/**
 * Steps a flow starts at, by purpose, plus the steps that collect an
 * identifier. The provider button belongs on all of them: a developer landing
 * on the first screen expects it there, and someone who has already gone to
 * the email screen should not have to go back for it.
 *
 * On the shipped password-first flow the login entry *is* `identifier`, so
 * this is exactly `identifier` and `register` — which is what the design's
 * reference flow shows. On passkey-first it also picks up the passkey entry
 * screen, which the reference never considered.
 */
function providerSteps(flow: Json): string[] {
  const purposes = isObject(flow.purposes) ? flow.purposes : {};
  const names = [purposes.login, purposes.register, "identifier", "register"];
  const wanted: string[] = [];
  for (const name of names) {
    if (typeof name === "string" && !wanted.includes(name) && stepNamed(flow, name) !== undefined) {
      wanted.push(name);
    }
  }
  return wanted;
}

/** Step the engine sends a new external identity to. */
const REGISTER_SSO = "register-sso";
/** Step shown when the provider's email already has an account. */
const SSO_CONFLICT = "sso-conflict";

/** Outcomes the engine fires after a provider returns, and where they go. */
const PROVIDER_OUTCOMES: Record<string, string> = {
  callback: "done",
  identity_unknown: REGISTER_SSO,
  user_already_exists: SSO_CONFLICT,
};

type Json = Record<string, unknown>;
type Step = Json & { name?: unknown };

/** What a generator left alone, so the caller can say so. */
export type SsoSkipped = {
  /** File-relative description, e.g. `steps.sso-conflict`. */
  readonly region: string;
  readonly reason: "hand-edited";
};

export type SsoResult<T> = {
  readonly document: T;
  /** True when the document changed; false makes a rerun a no-op. */
  readonly changed: boolean;
  readonly skipped: SsoSkipped[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function steps(flow: Json): Step[] {
  return Array.isArray(flow.steps) ? (flow.steps as Step[]) : [];
}

function stepNamed(flow: Json, name: string): Step | undefined {
  return steps(flow).find((step) => step.name === name);
}

/**
 * Enable the provider on a user schema.
 *
 * Only `x-auth-methods.sso` is touched: password and passkey configuration
 * belongs to whoever set it, and a provider is added to the list rather than
 * replacing it, so enabling a second one later keeps the first.
 */
export function applySsoToSchema(schema: object, slug: string): SsoResult<object> {
  const document = clone(schema) as Json;
  const methods = isObject(document["x-auth-methods"]) ? { ...document["x-auth-methods"] } : {};
  const existing = isObject(methods.sso) ? methods.sso : undefined;
  const providers = Array.isArray(existing?.providers) ? [...(existing.providers as unknown[])] : [];

  if (existing?.enabled === true && providers.includes(slug)) {
    return { document: schema, changed: false, skipped: [] };
  }
  if (!providers.includes(slug)) {
    providers.push(slug);
  }
  methods.sso = { ...existing, enabled: true, providers };
  document["x-auth-methods"] = methods;
  return { document, changed: true, skipped: [] };
}

/** The step that collects what the provider did not supply. */
function registerSsoStep(): Step {
  return {
    name: REGISTER_SSO,
    fields: ["email"],
    actions: [{ name: "submit", kind: "submit", primary: true, text_key: `${REGISTER_SSO}.action.submit` }],
    on_success: "create_user_with_sso",
    transitions: {
      submit: { target: "done" },
      user_already_exists: { target: SSO_CONFLICT },
    },
  };
}

/**
 * The step shown when the provider's email already has an account. It offers
 * only the methods the schema actually enables — a password box on a schema
 * without passwords is a dead end.
 */
function ssoConflictStep(slug: string, methods: { password: boolean; passkey: boolean }): Step {
  const actions: Json[] = [];
  const fields: string[] = [];
  if (methods.password) {
    fields.push("x-auth-methods#password");
    actions.push({ name: "submit", kind: "submit", primary: true, text_key: `${SSO_CONFLICT}.action.submit` });
  }
  if (methods.passkey) {
    actions.push({ name: "passkey", kind: "passkey", primary: false, text_key: `${SSO_CONFLICT}.action.passkey` });
  }
  actions.push({ name: "sign_in", kind: "navigate", primary: false, text_key: `${SSO_CONFLICT}.action.sign_in` });

  const transitions: Json = {};
  if (methods.password) {
    transitions.submit = { target: "done" };
  }
  if (methods.passkey) {
    transitions.passkey = { target: "done" };
  }
  transitions.callback = { target: "done" };
  transitions.user_already_exists = { target: SSO_CONFLICT };
  transitions.sign_in = { target: "identifier", purpose: "login" };
  transitions.identity_unknown = { target: REGISTER_SSO };

  return { name: SSO_CONFLICT, fields, actions, sso_providers: [slug], transitions };
}

/** Whether a step matches what this generator would write for it. */
function matches(step: Step, expected: Step): boolean {
  return JSON.stringify(step) === JSON.stringify(expected);
}

/**
 * Add the provider to a login flow.
 *
 * @param enabled - The authentication methods the target schema enables,
 *   which decide what the conflict step may offer.
 */
export function applySsoToFlow(
  flow: object,
  slug: string,
  enabled: { password: boolean; passkey: boolean },
): SsoResult<object> {
  const document = clone(flow) as Json;
  const skipped: SsoSkipped[] = [];
  let changed = false;

  for (const name of providerSteps(document)) {
    const step = stepNamed(document, name);
    if (step === undefined) {
      continue;
    }
    const providers = Array.isArray(step.sso_providers) ? [...(step.sso_providers as unknown[])] : [];
    if (!providers.includes(slug)) {
      providers.push(slug);
      step.sso_providers = providers;
      changed = true;
    }
    const transitions = isObject(step.transitions) ? { ...step.transitions } : {};
    for (const [outcome, target] of Object.entries(PROVIDER_OUTCOMES)) {
      const current = transitions[outcome];
      // `user_already_exists` already points at the password step on a
      // register flow. Retargeting it is the point: the same outcome now also
      // fires for a provider return, and the conflict step offers everything
      // the password step did.
      if (isObject(current) && current.target === target) {
        continue;
      }
      transitions[outcome] = { target };
      changed = true;
    }
    step.transitions = transitions;
  }

  // The password registration step shares the outcome, so it has to route to
  // the same place or a taken email dead-ends there.
  const registerPassword = stepNamed(document, "register-password");
  if (registerPassword !== undefined) {
    const transitions = isObject(registerPassword.transitions) ? { ...registerPassword.transitions } : {};
    const current = transitions.user_already_exists;
    if (!isObject(current) || current.target !== SSO_CONFLICT) {
      transitions.user_already_exists = { target: SSO_CONFLICT };
      registerPassword.transitions = transitions;
      changed = true;
    }
  }

  const list = steps(document);
  const terminalIndex = list.findIndex((step) => step.name === "done");
  const insertAt = terminalIndex === -1 ? list.length : terminalIndex;
  const wanted: Step[] = [registerSsoStep(), ssoConflictStep(slug, enabled)];
  let offset = 0;
  for (const step of wanted) {
    const existing = stepNamed(document, step.name as string);
    if (existing === undefined) {
      list.splice(insertAt + offset, 0, step);
      offset += 1;
      changed = true;
      continue;
    }
    if (!matches(existing, step)) {
      skipped.push({ region: `steps.${step.name as string}`, reason: "hand-edited" });
    }
  }
  document.steps = list;

  return changed || skipped.length > 0
    ? { document, changed, skipped }
    : { document: flow, changed: false, skipped };
}
