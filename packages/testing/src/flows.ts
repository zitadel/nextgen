import type { Locator, Page } from "@playwright/test";

/**
 * Helpers that drive the `<zitadel-login>` widget through complete auth
 * ceremonies, built on the widget's documented automation hooks
 * (`zitadel-field-*` / `zitadel-input-*` on fields, `zitadel-action-*` on
 * actions — see packages/components/README.md). Field names use the
 * normalised hook token: the flow engine names credential fields
 * `x-auth-methods#password`, but the hook (and this API) says `password`.
 *
 * The ceremony helpers assume the default flow vocabulary — steps that
 * declare `submit` / `passkey` / `passkey_register` actions and `email` /
 * password fields, as `default-login.json` does. They branch only on
 * widget-observable state (which fields and actions the flow renders),
 * because customer flow configurations legitimately vary; they never
 * assert app state. Callers navigate to the widget first and assert their
 * own signed-in surface afterwards. Flows with renamed actions or custom
 * steps drive the widget directly via `flowAction` / `flowField`.
 */

export interface FlowActionOptions {
  /**
   * Accessible-name fallback for templates that do not emit the documented
   * `data-testid` hooks: adds role-based button/link candidates.
   */
  name?: RegExp;
}

export interface FlowFieldOptions {
  /** Label fallback for templates that do not emit the documented hooks. */
  label?: RegExp;
}

/**
 * One optional registration field, filled only when the flow renders it.
 * The value's type picks the control: a boolean drives a checkbox
 * (`zl-checkbox`), a string first tries a select (`zl-select`) and falls
 * back to filling a text-like input.
 */
export interface ProfileEntry {
  /** Normalised field hook token, e.g. `givenName`. */
  field: string;
  value: string | boolean;
  /** Label fallback for text-like inputs on templates without hooks. */
  label?: RegExp;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegistrationDetails {
  email: string;
  /** Extra fields some flows require at registration, filled if rendered. */
  profile?: ProfileEntry[];
}

export interface PasswordRegistrationDetails extends RegistrationDetails {
  password: string;
}

/**
 * A union locator resolves in DOM order across the whole page, so every
 * candidate built from a broad selector — accessible names, labels, the
 * generic `data-action` attribute — is scoped to the `<zitadel-login>`
 * host; otherwise a same-named control in the app's own chrome (header
 * nav, footer forms) could win the union. The host element exists no
 * matter what the tenant's template renders, so these fallbacks keep
 * working for custom templates that emit no automation hooks — the case
 * they exist for. The `zitadel-*` testid hooks and the `zl-button` atom
 * are namespaced and stay page-global.
 */
function widgetRoot(page: Page): Locator {
  return page.locator("zitadel-login");
}

/**
 * Escape a value for use inside a double-quoted CSS attribute selector,
 * per the CSSOM "serialize a string" rules: NUL becomes U+FFFD, control
 * characters become hex code-point escapes, quote and backslash are
 * backslash-escaped. C1 controls (U+0080–U+009F) are escaped too — CSSOM
 * itself leaves them literal, but the escaped form is equivalent and
 * survives stricter-than-spec selector parsers. Anything the flow schema
 * accepts as an action name yields a parseable selector.
 */
function cssAttributeValue(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0) {
      out += "�";
    } else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      out += `\\${code.toString(16)} `;
    } else if (ch === '"' || ch === "\\") {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Locator for a flow action control by its declared action name. Matches
 * every hook shape the default template emits — host testid, native
 * shadow button/link testids, and the raw `action`/`data-action`
 * attributes (the recover link carries only `data-action`).
 */
export function flowAction(page: Page, action: string, options: FlowActionOptions = {}): Locator {
  // Action names are free-form in the flow schema; escape them before
  // interpolating into attribute selectors so an exotic name cannot break
  // the whole union's parsing.
  const attributeSafe = cssAttributeValue(action);
  let candidates = page
    .getByTestId(`zitadel-action-${action}`)
    .or(page.getByTestId(`zitadel-action-${action}-button`))
    .or(page.getByTestId(`zitadel-action-${action}-link`))
    .or(page.locator(`zl-button[action="${attributeSafe}"]`))
    .or(widgetRoot(page).locator(`[data-action="${attributeSafe}"]`));
  if (options.name) {
    candidates = candidates
      .or(widgetRoot(page).getByRole("button", { name: options.name }))
      .or(widgetRoot(page).getByRole("link", { name: options.name }));
  }
  return candidates.first();
}

/**
 * Locator for a flow field's input by its normalised hook token
 * (`email`, `password`, a user-schema property name).
 */
export function flowField(page: Page, field: string, options: FlowFieldOptions = {}): Locator {
  let candidates = page
    .getByTestId(`zitadel-input-${field}`)
    .or(page.getByTestId(`zitadel-field-${field}`).locator("input"));
  if (options.label) {
    candidates = candidates.or(widgetRoot(page).getByLabel(options.label));
  }
  return candidates.first();
}

/** Click a flow action (auto-waits like any locator click). */
export async function clickFlowAction(
  page: Page,
  action: string,
  options?: FlowActionOptions,
): Promise<void> {
  await flowAction(page, action, options).click();
}

/** Fill a flow field (auto-waits like any locator fill). */
export async function fillFlowField(
  page: Page,
  field: string,
  value: string,
  options?: FlowFieldOptions,
): Promise<void> {
  await flowField(page, field, options).fill(value);
}

/**
 * Sign in with email and password from the flow's entry step. Handles both
 * the default split shape (identifier → password) and flows that render
 * the password field on the entry step.
 */
export async function loginWithPassword(
  page: Page,
  { email, password }: LoginCredentials,
): Promise<void> {
  await emailField(page).fill(email);
  const password_ = passwordField(page);
  if (!(await password_.isVisible().catch(() => false))) {
    await flowAction(page, "submit").click();
  }
  await password_.fill(password);
  await flowAction(page, "submit").click();
}

/**
 * Sign in with a passkey. With `email`, fills the identifier and takes the
 * step's passkey action; without, taps the entry step's passkey action
 * directly (discoverable-credential one-tap, e.g. the passkey-first
 * preset). Pair with `enableVirtualPasskey` / the `passkey` fixture in
 * headless runs — the ceremony completes automatically once the widget
 * issues the WebAuthn challenge.
 */
export async function loginWithPasskey(page: Page, options: { email?: string } = {}): Promise<void> {
  if (options.email !== undefined) {
    await emailField(page).fill(options.email);
  }
  await flowAction(page, "passkey").click();
}

/**
 * Register a new user with a password: enter the (unknown) identifier,
 * advance into the registration step, continue on the password path, and
 * submit the password. Ends when the final submit is clicked — assert your
 * app's signed-in surface afterwards. Flows that route through steps the
 * default flow does not (e.g. a passkey upsell) need caller-side handling
 * after this returns.
 */
export async function registerWithPassword(
  page: Page,
  { email, password, profile }: PasswordRegistrationDetails,
): Promise<void> {
  await advanceToRegistration(page, email, profile);
  // Continue with password unless this flow renders the password field on
  // the registration step itself.
  const password_ = passwordField(page);
  if (!(await password_.isVisible().catch(() => false))) {
    await flowAction(page, "submit").click();
  }
  await password_.fill(password);
  await flowAction(page, "submit").click();
}

/**
 * Register a new user with a passkey: enter the (unknown) identifier,
 * advance into the registration step, and take its `passkey_register`
 * action. Requires an authenticator (see `loginWithPasskey`). The default
 * flow completes registration from the ceremony directly.
 */
export async function registerWithPasskey(
  page: Page,
  { email, profile }: RegistrationDetails,
): Promise<void> {
  await advanceToRegistration(page, email, profile);
  await flowAction(page, "passkey_register").click();
}

function emailField(page: Page): Locator {
  return flowField(page, "email", { label: /email/i });
}

function passwordField(page: Page): Locator {
  return flowField(page, "password", { label: /password/i });
}

/**
 * From the entry step: submit the unknown identifier (the default flow's
 * `user_not_found` transition routes to registration), or take an explicit
 * `register` navigate action when the entry step is a combined
 * email+password step — there, submitting would attempt a password sign-in
 * instead. Then wait for the registration step and fill what it renders.
 */
async function advanceToRegistration(
  page: Page,
  email: string,
  profile: ProfileEntry[] | undefined,
): Promise<void> {
  await emailField(page).fill(email);
  if (await passwordField(page).isVisible().catch(() => false)) {
    await flowAction(page, "register").click();
  } else {
    await flowAction(page, "submit").click();
  }
  await expectRegistrationStep(page);
  // The engine echoes the attempted identifier into the registration step's
  // email field; refill defensively for flows that render it empty.
  await fillIfVisible(emailField(page), email);
  for (const entry of profile ?? []) {
    await fillProfileEntry(page, entry);
  }
}

/**
 * Fill one registration field with the verb its control needs: booleans
 * check the `zl-checkbox` native input, strings prefer the `zl-select`
 * native select (option matched by value, falling back to label) and
 * otherwise fill a text-like input. The select/checkbox natives carry the
 * name-first testids the atoms document (`zitadel-select-*`,
 * `zitadel-checkbox-*`); templates without those hooks drive such fields
 * via their own locators.
 */
async function fillProfileEntry(page: Page, entry: ProfileEntry): Promise<void> {
  if (typeof entry.value === "boolean") {
    const checkbox = page.getByTestId(`zitadel-checkbox-${entry.field}`).first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.setChecked(entry.value);
    }
    return;
  }
  const select = page.getByTestId(`zitadel-select-${entry.field}`).first();
  if (await select.isVisible().catch(() => false)) {
    await select.selectOption(entry.value);
    return;
  }
  await fillIfVisible(flowField(page, entry.field, { label: entry.label }), entry.value);
}

/**
 * Barrier between the entry submit and probing the registration step's
 * fields: without it, optional-field probes race the re-render and read
 * the outgoing step. The default flow's registration step declares
 * `passkey_register` — a structural, locale-independent signal; the
 * heading regex covers password-only flows on the default English
 * template.
 */
async function expectRegistrationStep(page: Page): Promise<void> {
  await flowAction(page, "passkey_register")
    .or(widgetRoot(page).getByRole("heading", { name: /create|register|sign up|no-account/i }))
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function fillIfVisible(field: Locator, value: string): Promise<void> {
  if (await field.isVisible().catch(() => false)) {
    await field.fill(value);
  }
}
