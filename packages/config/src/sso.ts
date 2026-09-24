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

/**
 * The step a flow starts its login purpose at, which a transition that
 * re-purposes to `login` must target.
 *
 * The engine rejects a `purpose: "login"` transition pointing anywhere else,
 * so this cannot be hardcoded: `identifier` is only the password-first flow's
 * entry, and a passkey-first flow starts at its passkey screen.
 */
function loginEntry(flow: Json): string | undefined {
  const purposes = isObject(flow.purposes) ? flow.purposes : {};
  const named = purposes.login;
  if (typeof named === "string" && stepNamed(flow, named) !== undefined) {
    return named;
  }
  // A flow that does not serve the login purpose has nowhere to send someone
  // who wants to sign in instead, and the validator rejects a transition that
  // re-purposes to a purpose the definition does not serve. Falling back to
  // `identifier` would write exactly that.
  return stepNamed(flow, "identifier") !== undefined && purposes.login !== undefined
    ? "identifier"
    : undefined;
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
function ssoConflictStep(
  slug: string,
  methods: { password: boolean; passkey: boolean },
  loginStep: string | undefined,
): Step {
  const actions: Json[] = [];
  const fields: string[] = [];
  if (methods.password) {
    fields.push("x-auth-methods#password");
    actions.push({ name: "submit", kind: "submit", primary: true, text_key: `${SSO_CONFLICT}.action.submit` });
  }
  if (methods.passkey) {
    actions.push({ name: "passkey", kind: "passkey", primary: false, text_key: `${SSO_CONFLICT}.action.passkey` });
  }
  if (loginStep !== undefined) {
    actions.push({
      name: "sign_in",
      kind: "navigate",
      primary: false,
      text_key: `${SSO_CONFLICT}.action.sign_in`,
    });
  }

  const transitions: Json = {};
  if (methods.password) {
    transitions.submit = { target: "done" };
  }
  if (methods.passkey) {
    transitions.passkey = { target: "done" };
  }
  transitions.callback = { target: "done" };
  transitions.user_already_exists = { target: SSO_CONFLICT };
  if (loginStep !== undefined) {
    transitions.sign_in = { target: loginStep, purpose: "login" };
  }
  transitions.identity_unknown = { target: REGISTER_SSO };

  return { name: SSO_CONFLICT, fields, actions, sso_providers: [slug], transitions };
}

/**
 * Whether a step is still what this generator would write for it.
 *
 * Compared key-sorted at every depth: the CLI writes its managed files with a
 * stable serialiser, so a step that has been through `setup` or any `apply`
 * has its keys in a different order from the object built here while being
 * the same step. Comparing the raw JSON would report the generator's own
 * output as hand-edited.
 */
function matches(step: Step, expected: Step): boolean {
  return canonical(step) === canonical(expected);
}

/** The provider list a step should end up with: what it has, plus this slug. */
function mergedProviders(step: Step, slug: string): unknown[] {
  const providers = Array.isArray(step.sso_providers) ? [...(step.sso_providers as unknown[])] : [];
  return providers.includes(slug) ? providers : [...providers, slug];
}

/**
 * Offer a provider on a step, keeping any already there. Returns whether the
 * step changed, so a rerun is a no-op.
 */
function addProvider(step: Step, slug: string): boolean {
  const providers = Array.isArray(step.sso_providers) ? [...(step.sso_providers as unknown[])] : [];
  if (providers.includes(slug)) {
    return false;
  }
  providers.push(slug);
  step.sso_providers = providers;
  return true;
}

/** Stable JSON: object keys sorted at every depth, arrays left in order. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
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
    if (addProvider(step, slug)) {
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
  const wanted: Step[] = [registerSsoStep(), ssoConflictStep(slug, enabled, loginEntry(document))];
  let offset = 0;
  for (const step of wanted) {
    const name = step.name as string;
    const existing = stepNamed(document, name);
    if (existing === undefined) {
      list.splice(insertAt + offset, 0, step);
      offset += 1;
      changed = true;
      continue;
    }
    // The conflict step carries a provider list of its own, so a second
    // provider is added to it rather than replacing the first — otherwise the
    // generator would report its own output as hand-edited and leave the
    // screen offering only the provider that was enabled first. `register-sso`
    // declares none, so it is compared as written.
    const expected = step.sso_providers === undefined
      ? step
      : { ...step, sso_providers: mergedProviders(existing, slug) };
    if (step.sso_providers !== undefined && addProvider(existing, slug)) {
      changed = true;
    }
    if (!matches(existing, expected)) {
      skipped.push({ region: `steps.${name}`, reason: "hand-edited" });
    }
  }
  document.steps = list;

  return changed || skipped.length > 0
    ? { document, changed, skipped }
    : { document: flow, changed: false, skipped };
}
