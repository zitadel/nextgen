import { describe, expect, it, vi } from "vitest";

import { createLiquidEngine, localiseFlowErrorKeys } from "./liquid.js";
import { en as fullLocale } from "./locales/en.js";
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";
import { TEMPLATE_NAMES } from "./template-names.js";

/**
 * Convert author-friendly `{ name: {...}, ... }` dicts into the wire-shape
 * `[{ name, ... }, ...]` array. Keeps each test's context authoring concise
 * while matching the runtime contract.
 */
function toArray<T extends object>(entries: Record<string, T>): ({ name: string } & T)[] {
  return Object.entries(entries).map(([name, body]) => ({ name, ...body }));
}

const locale: Record<string, string> = {
  "identifier.title": "Sign in",
  "identifier.field.email": "Work email",
  "identifier.field.email.placeholder": "you@company.com",
  "password.title": "Sign in",
  "passkey-upsell.title": "Sign in faster next time",
  "passkey-upsell.description.line1": "No password needed ever again.",
  "passkey-upsell.description.line2": "Sign in with Face ID, Touch ID, or PIN.",
  "passkey-upsell.action.setup": "Set up passkey",
  "complete.title": "You're signed in as",
  "submit.continue": "Continue",
};

describe("LiquidJS engine", () => {
  it("auto-escapes {{ }} output by default", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("<p>{{ value }}</p>", {
      value: "<img src=x onerror=alert(1)>",
    });
    expect(result).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("the | t filter resolves text_key strings", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("{{ key | t }}", { key: "identifier.title" });
    expect(result).toBe("Sign in");
  });

  it("the | t filter falls through to the raw key when missing", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("{{ key | t }}", { key: "unknown.key" });
    expect(result).toBe("unknown.key");
  });

  it("warns once per missing key, and never for fallback-served or empty keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const engine = createLiquidEngine({ locale: { ...locale, "action.back": "Back" } });
      // Raw-key miss: warns on first render only.
      engine.parseAndRenderSync("{{ key | t }}", { key: "unknown.key" });
      engine.parseAndRenderSync("{{ key | t }}", { key: "unknown.key" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[zitadel-login] missing text key "unknown.key" — rendering the raw key',
      );
      // Served by the injected-key and field-label fallbacks: no warning.
      engine.parseAndRenderSync("{{ key | t }}", { key: "custom-step.action.back" });
      engine.parseAndRenderSync("{{ key | t }}", { key: "register.field.givenName" });
      // Undefined text_key stringifies to "": no warning.
      engine.parseAndRenderSync("{{ key | t }}", { key: undefined });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("the | t filter falls back to the generic action.back for custom step names", () => {
    // The engine injects `<step>.action.back` from tenant-chosen step names
    // (flow_state_machine.go buildStep) — no dictionary can enumerate them.
    const engine = createLiquidEngine({ locale: { ...locale, "action.back": "Back" } });
    const result = engine.parseAndRenderSync("{{ key | t }}", {
      key: "passkey-first.action.back",
    });
    expect(result).toBe("Back");
  });

  it("a step-specific action.back key wins over the generic fallback", () => {
    const engine = createLiquidEngine({
      locale: { ...locale, "action.back": "Back", "recover.action.back": "Back to sign in" },
    });
    const result = engine.parseAndRenderSync("{{ key | t }}", { key: "recover.action.back" });
    expect(result).toBe("Back to sign in");
  });

  it("action.back keys still fall through to the raw key when no generic exists", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("{{ key | t }}", { key: "custom.action.back" });
    expect(result).toBe("custom.action.back");
  });

  it("the builtin locales ship the generic action.back", () => {
    expect(fullLocale["action.back"]).toBe("Back");
  });

  it("the | t filter humanises uncatalogued field-label keys", () => {
    // Custom schema properties (`department`, `dateOfBirth`) produce
    // `<step>.field.<name>` label keys no catalog can enumerate — the
    // form must not render the raw key.
    const engine = createLiquidEngine({ locale });
    expect(engine.parseAndRenderSync("{{ key | t }}", { key: "register.field.department" })).toBe(
      "Department",
    );
    expect(engine.parseAndRenderSync("{{ key | t }}", { key: "register.field.dateOfBirth" })).toBe(
      "Date of birth",
    );
    expect(
      engine.parseAndRenderSync("{{ key | t }}", { key: "register.field.emergency_contact" }),
    ).toBe("Emergency contact");
  });

  it("a catalogued field-label key wins over the humanised fallback", () => {
    const engine = createLiquidEngine({
      locale: { ...locale, "register.field.department": "Team" },
    });
    const result = engine.parseAndRenderSync("{{ key | t }}", {
      key: "register.field.department",
    });
    expect(result).toBe("Team");
  });

  it("splits on the last .field. for step names that contain the marker", () => {
    // Step names are tenant-chosen: "signup.field.v2" is a legal step
    // name, and the property name always follows the final ".field.".
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("{{ key | t }}", {
      key: "signup.field.v2.field.department",
    });
    expect(result).toBe("Department");
  });

  it("field sub-keys (placeholder/help) do not take the humanised fallback", () => {
    // `.placeholder`/`.help` resolve through their own filters, which stay
    // empty on a miss; `| t` keeps returning the raw key for them.
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("{{ key | t }}", {
      key: "register.field.department.placeholder",
    });
    expect(result).toBe("register.field.department.placeholder");
  });

  it("fieldPlaceholder resolves sibling keys", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync(
      `{{ "identifier.field.email" | fieldPlaceholder }}`,
      {},
    );
    expect(result).toBe("you@company.com");
  });

  it("fieldPlaceholder returns empty when undefined", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync(`{{ "password.title" | fieldPlaceholder }}`, {});
    expect(result).toBe("");
  });

  it("the | raw filter is overridden to escape", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("<p>{{ value | raw }}</p>", {
      value: "<script>alert(1)</script>",
    });
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("emits the mandatory_gates marker comment", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync("{% mandatory_gates %}", {});
    expect(result).toBe(mandatoryGatesMarkerComment);
  });

  it("renders the bundled default template through the auth-form partial", () => {
    const engine = createLiquidEngine({ locale });
    const f = toArray({
      identifier: { type: "email", text_key: "identifier.title", required: true },
    });
    const a = toArray({ submit: { text_key: "submit.continue", primary: true } });
    const context = {
      step: { name: "identifier", type: "identifier", texts: { title_key: "identifier.title" } },
      fields: f,
      actions: a,
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("<zl-page-shell");
    expect(result).toContain("<zl-card");
    expect(result).toContain("<zl-field");
    expect(result).toContain('data-testid="zitadel-field-identifier"');
    expect(result).toContain("<zl-button");
    expect(result).toContain('data-testid="zitadel-action-submit"');
    expect(result).toContain('hierarchy="primary"');
    expect(result).toContain(mandatoryGatesMarkerComment);
  });

  it("normalises auth-method credential names in testids but not in name", () => {
    // The real flow engine names the credential field
    // `x-auth-methods#password`; the documented hook is method-named.
    const engine = createLiquidEngine({ locale });
    const f = toArray({
      "x-auth-methods#password": {
        type: "password",
        text_key: "password.field.password",
        required: true,
      },
    });
    const a = toArray({ submit: { text_key: "submit.continue", primary: true } });
    const context = {
      step: { name: "password", type: "password", texts: { title_key: "password.title" } },
      fields: f,
      actions: a,
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('data-testid="zitadel-field-password"');
    expect(result).not.toContain('data-testid="zitadel-field-x-auth-methods#password"');
    expect(result).toContain('name="x-auth-methods#password"');
  });

  it("renders step title from locale via default template", () => {
    const engine = createLiquidEngine({ locale });
    const a = toArray({ submit: { text_key: "submit.continue", primary: true } });
    const context = {
      step: { name: "password", texts: { title_key: "password.title" } },
      fields: [],
      actions: a,
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: { display_name: "Alice" },
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("Sign in");
  });

  it("renders passkey upsell: card, primary + secondary CTAs", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const a = toArray({
      setup: { text_key: "passkey-upsell.action.setup", primary: true },
      skip: { text_key: "passkey-upsell.action.skip" },
    });
    const context = {
      step: { name: "passkey-upsell", texts: { title_key: "passkey-upsell.title" } },
      fields: [],
      actions: a,
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("Sign in faster next time");
    expect(result).toContain('action="setup"');
    expect(result).toContain('action="skip"');
    expect(result).toContain('hierarchy="primary"');
    expect(result).toContain('hierarchy="secondary"');
    expect(result).not.toContain("<zl-field");
  });

  it("renders passkey upsell setup error: form-level alert, retry allowed", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const a = toArray({
      setup: { text_key: "passkey-upsell.action.setup", primary: true },
      skip: { text_key: "passkey-upsell.action.skip" },
    });
    const context = {
      step: { name: "passkey-upsell", texts: { title_key: "passkey-upsell.title" } },
      fields: [],
      actions: a,
      branding: {},
      loading: false,
      errors: [{ text_key: "error.passkey_cancelled" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('<zl-alert severity="error"');
    expect(result).toContain("The passkey prompt was closed before completing.");
    expect(result).toContain('action="setup"');
    expect(result).not.toContain("invalid");
  });

  it("renders the engine's passkey proof rejection as a localized alert", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const a = toArray({
      submit: { text_key: "identifier.action.continue", primary: true },
    });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: [],
      actions: a,
      branding: {},
      loading: false,
      // The state machine re-renders the step with this key when the server
      // rejects a passkey assertion (flow_state_machine.go processPasskey).
      errors: [{ text_key: "error.passkey_invalid" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('<zl-alert severity="error"');
    expect(result).toContain("This passkey could not be verified");
    expect(result).not.toContain("error.passkey_invalid");
  });

  it("renders the engine's passkey registration rejection as a localized alert", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const a = toArray({
      setup: { text_key: "passkey-upsell.action.setup", primary: true },
      skip: { text_key: "passkey-upsell.action.skip" },
    });
    const context = {
      step: { name: "passkey-upsell", texts: { title_key: "passkey-upsell.title" } },
      fields: [],
      actions: a,
      branding: {},
      loading: false,
      // The state machine re-renders the step with this key when the server
      // rejects a registration attestation (flow_state_machine.go processPasskey).
      errors: [{ text_key: "error.passkey_registration_invalid" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('<zl-alert severity="error"');
    expect(result).toContain("The new passkey could not be verified");
    expect(result).not.toContain("error.passkey_registration_invalid");
  });

  it("renders passkey registration challenges with registration ceremony", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const context = {
      step: { name: "passkey-enroll", texts: { title_key: "passkey-enroll.title" } },
      fields: [],
      actions: [],
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
      challenge: {
        method: "passkey_register",
        challenge_id: "reg-1",
        options: {
          challenge: "AAAA",
          rp: { id: "example.com", name: "example.com" },
          user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
      },
    };

    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("<zl-passkey");
    expect(result).toContain('ceremony="register"');
    expect(result).toContain('method="passkey_register"');
    expect(result).toContain('challenge-id="reg-1"');
  });

  it("keeps legacy passkey registration challenges working when options.user is present", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const context = {
      step: { name: "passkey-enroll", texts: { title_key: "passkey-enroll.title" } },
      fields: [],
      actions: [],
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
      challenge: {
        method: "passkey",
        challenge_id: "reg-1",
        options: {
          user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
        },
      },
    };

    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('ceremony="register"');
    expect(result).toContain('method="passkey_register"');
  });

  it("renders the signed-in screen when the step is the signed-in confirmation", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "signed-in", texts: { title_key: "complete.title" } },
      fields: [],
      actions: [],
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: { display_name: "Alice", email_address: "alice@acme.com" },
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("zl-card-title");
  });

  // A template-capability test, not the default flow: the default flow splits
  // email and credential across two steps. The template must still render
  // whatever field set a tenant's flow definition declares on one step,
  // including an email+password pair (Figma `6593:141983`).
  it("renders an email+password step on one card: autocomplete, forgot link, sign-in CTA", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const f = toArray({
      email: { type: "email", text_key: "identifier.field.email", required: true },
      password: { type: "password", text_key: "identifier.field.password", required: true },
    });
    const a = toArray({
      submit: { text_key: "submit.signin", primary: true },
      passkey: { text_key: "identifier.action.passkey" },
      register: { text_key: "identifier.action.register.link" },
      recover: { text_key: "action.forgot_password" },
    });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: f,
      actions: a,
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('autocomplete="email"');
    expect(result).toContain('autocomplete="current-password"');
    expect(result).toContain('class="zl-card-forgot"');
    expect(result).toContain('data-action="recover"');
    expect(result).not.toContain("forgot-password-href");
    expect(result).toContain('label="Sign in"');
    expect(result).not.toContain('label="Continue"');
    const passkeyButtons =
      result.match(/<zl-button[^>]*data-testid="zitadel-action-passkey"[^>]*>/g) ?? [];
    expect(passkeyButtons).toHaveLength(1);
    expect(passkeyButtons[0]).toContain('hierarchy="secondary"');
  });

  it("renders a primary passkey action as exactly one button (passkey-first flow)", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const a = toArray({
      passkey: { text_key: "identifier.action.passkey", primary: true },
      register: { text_key: "identifier.action.register.link" },
    });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: [],
      actions: a,
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    const passkeyButtons =
      result.match(/<zl-button[^>]*data-testid="zitadel-action-passkey"[^>]*>/g) ?? [];
    expect(passkeyButtons).toHaveLength(1);
    expect(passkeyButtons[0]).toContain('hierarchy="primary"');
    expect(result).not.toContain('hierarchy="secondary"');
  });

  it("renders sign-in wrong credentials (6602:180268): inline password error, no form alert", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const f = toArray({
      email: { type: "email", text_key: "identifier.field.email", required: true },
      password: { type: "password", text_key: "identifier.field.password", required: true },
    });
    const a = toArray({
      submit: { text_key: "submit.signin", primary: true },
      recover: { text_key: "action.forgot_password" },
    });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: f,
      actions: a,
      branding: {},
      loading: false,
      errors: [{ field: "password", text_key: "error.invalid_credentials" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("Wrong email or password.");
    expect(result).toContain('name="password"');
    expect(result).toContain("invalid");
    expect(result).not.toContain('<zl-alert severity="error">Wrong email');
    expect(result).not.toContain('<zl-alert severity="error"');
  });

  it("renders sign-in server error (6594:125237): heading + body alert, fields unchanged", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const f = toArray({
      email: { type: "email", text_key: "identifier.field.email", required: true },
      password: { type: "password", text_key: "identifier.field.password", required: true },
    });
    const a = toArray({
      submit: { text_key: "submit.signin", primary: true },
      recover: { text_key: "action.forgot_password" },
    });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: f,
      actions: a,
      branding: {},
      loading: false,
      errors: [{ text_key: "error.sign_in_server" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('heading="We couldn&#39;t complete your sign in."');
    expect(result).toContain("Please try again in a few minutes");
    expect(result).toContain('autocomplete="email"');
    expect(result).toContain('autocomplete="current-password"');
    expect(result).not.toContain("Wrong email or password.");
  });

  it("renders sign-up field annotations (6593:141741): autocomplete, help, inline email error", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const f = toArray({
      email: { type: "email", text_key: "register.field.email", required: true },
      password: { type: "password", text_key: "register.field.password", required: true },
      dateOfBirth: { type: "date", text_key: "register.field.dateOfBirth", required: true },
    });
    const a = toArray({
      submit: { text_key: "register.action.submit", primary: true },
    });
    const context = {
      step: { name: "register", texts: { title_key: "register.title" } },
      fields: f,
      actions: a,
      branding: {},
      loading: false,
      errors: [{ field: "email", text_key: "error.email_exists" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('autocomplete="email"');
    expect(result).toContain('autocomplete="new-password"');
    // Password complexity copy and the YYYY-MM-DD date hint were removed: only
    // minLength is enforced server-side, and native <input type="date"> handles
    // its own localized format (#251 tracks dynamic, rule-driven hints).
    expect(result).not.toContain("At least 8 characters");
    expect(result).not.toContain('placeholder="YYYY-MM-DD"');
    expect(result).not.toContain("Use YYYY-MM-DD.");
    expect(result).toContain("An account with this email already exists");
    expect(result).not.toContain("forgot-password-href");
    expect(result).not.toContain('<zl-alert severity="error">An account');
    expect(result).not.toContain("forgot-password-href");
    expect(result).not.toContain('data-action="sign_in"');
    expect(result).not.toContain('class="zl-card-nav"');
    expect(result).toContain('label="Sign up"');
    expect(result).not.toContain("compact");
  });

  it("renders the default template when the API returns a terminal step (complete: show)", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "done", complete: "show", texts: { title_key: "complete.title" } },
      fields: [],
      actions: [],
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: { email_address: "qwertz@acme.com" },
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("zl-card-title");
  });
});

/**
 * Pure-function matrix for localising the server's `step.error` validation
 * keys (`error.<field>_<rule>`, "; "-joined — see
 * `FlowFieldValidationErrors.StepError()` in
 * `internal/domain/flow_field_resolver.go`).
 */
describe("localiseFlowErrorKeys", () => {
  const ctx = { locale: fullLocale, stepName: "register" };

  it("passes catalog-known field-specific keys through as text keys, tagged with their field", () => {
    expect(localiseFlowErrorKeys("error.email_required", ctx)).toEqual([
      { field: "email", text_key: "error.email_required" },
    ]);
    // The server spells format violations `_invalid` — the catalog's
    // existing convention, which fieldErrorKeys routes inline.
    expect(localiseFlowErrorKeys("error.email_invalid", ctx)).toEqual([
      { field: "email", text_key: "error.email_invalid" },
    ]);
    expect(localiseFlowErrorKeys("error.password_required", ctx)).toEqual([
      { field: "password", text_key: "error.password_required" },
    ]);
  });

  it("falls back to a localised generic message with the step's field label", () => {
    // No `error.email_min_length` key exists; the label comes from
    // `register.field.email` when present, else the humanised name.
    const result = localiseFlowErrorKeys("error.email_min_length", {
      locale: { ...fullLocale, "register.field.email": "Work email" },
      stepName: "register",
    });
    expect(result).toEqual([{ message: "Work email is too short." }]);
  });

  it("humanises unknown field names (camelCase, snake_case, x-auth-methods#…)", () => {
    expect(localiseFlowErrorKeys("error.givenName_required", ctx)).toEqual([
      { message: "Given name is required." },
    ]);
    expect(localiseFlowErrorKeys("error.date_of_birth_invalid", ctx)).toEqual([
      { message: "Please enter a valid date of birth." },
    ]);
    expect(localiseFlowErrorKeys("error.x-auth-methods#password_min_length", ctx)).toEqual([
      { message: "Password is too short." },
    ]);
  });

  it("covers every rule suffix's generic fallback, including unknown_field", () => {
    expect(localiseFlowErrorKeys("error.nickname_max_length", ctx)).toEqual([
      { message: "Nickname is too long." },
    ]);
    expect(localiseFlowErrorKeys("error.nickname_unknown_field", ctx)).toEqual([
      { message: "Please check nickname." },
    ]);
  });

  it("splits '; '-joined violations into one error per key", () => {
    const result = localiseFlowErrorKeys("error.email_invalid; error.password_min_length", {
      locale: { ...fullLocale, "register.field.password": "Password" },
      stepName: "register",
    });
    expect(result).toEqual([
      { field: "email", text_key: "error.email_invalid" },
      { message: "Password is too short." },
    ]);
  });

  it("passes non-validation error keys through for the template's key lookups", () => {
    // `error.sign_in_server` localises via its `.title`/`.body` sub-keys
    // in the alert filters; no rule suffix must not mean a lost error.
    expect(localiseFlowErrorKeys("error.sign_in_server", ctx)).toEqual([
      { text_key: "error.sign_in_server" },
    ]);
  });

  it("localises the engine's credential rejections via the catalog", () => {
    // SubmitPassword / SubmitPasskey rejections re-render the step with
    // these catalog keys (flow_state_machine.go) — invalid_credentials
    // routes inline to the password field via fieldErrorKeys; passkey_invalid
    // has no field mapping, so it stays a form-level (banner) text key.
    expect(localiseFlowErrorKeys("error.invalid_credentials", ctx)).toEqual([
      { field: "password", text_key: "error.invalid_credentials" },
    ]);
    expect(localiseFlowErrorKeys("error.passkey_invalid", ctx)).toEqual([
      { text_key: "error.passkey_invalid" },
    ]);
  });

  it("returns null for anything that is not an error.* key payload", () => {
    // Outcome tokens stay verbatim with the caller.
    expect(localiseFlowErrorKeys("user_not_found", ctx)).toBeNull();
    expect(localiseFlowErrorKeys("", ctx)).toBeNull();
    // A single non-key segment rejects the whole payload.
    expect(localiseFlowErrorKeys("error.email_required; user_not_found", ctx)).toBeNull();
  });

  it("survives a locale without the generic keys via the hardcoded fallback", () => {
    const result = localiseFlowErrorKeys("error.nickname_required", {
      locale: {},
      stepName: "register",
    });
    expect(result).toEqual([{ message: "Please check nickname." }]);
  });

  it("downgrades inline-routed keys to a banner message when the step lacks the field", () => {
    // fieldErrorKeys routes error.email_* inline to the email field, and
    // formLevelError suppresses their banner. On a step without an email
    // field the inline outlet doesn't exist — without the downgrade the
    // error would render nowhere.
    // The label resolves through the step's catalog entry
    // (`register.field.email` → "Email"), not the bare field name.
    expect(localiseFlowErrorKeys("error.email_required", { ...ctx, fields: ["password"] })).toEqual(
      [{ message: "Email is required." }],
    );
    // Inline key without a recognised rule suffix: its catalog copy
    // becomes the banner message verbatim.
    expect(localiseFlowErrorKeys("error.email_exists", { ...ctx, fields: ["password"] })).toEqual([
      { message: "An account with this email already exists." },
    ]);
  });

  it("keeps inline routing when the step carries the field", () => {
    expect(
      localiseFlowErrorKeys("error.email_required", { ...ctx, fields: ["email", "password"] }),
    ).toEqual([{ field: "email", text_key: "error.email_required" }]);
    // Without a fields list (pure lookups) the check is skipped entirely.
    expect(localiseFlowErrorKeys("error.email_required", ctx)).toEqual([
      { field: "email", text_key: "error.email_required" },
    ]);
  });

  it("routes a generic (non-catalog) field error inline when the step renders that field", () => {
    // `error.<field>_<rule>` for a schema field the step shows: the pre-localised
    // message is tagged with its field so the template renders it inline under
    // the control (the select/checkbox/text field) instead of the banner.
    expect(
      localiseFlowErrorKeys("error.country_required", {
        ...ctx,
        fields: ["email", "country"],
      }),
    ).toEqual([{ field: "country", message: "Country is required." }]);
    // A rule-suffixed key without a catalog entry, label from the step catalog.
    expect(
      localiseFlowErrorKeys("error.email_min_length", {
        locale: { ...fullLocale, "register.field.email": "Work email" },
        stepName: "register",
        fields: ["email"],
      }),
    ).toEqual([{ field: "email", message: "Work email is too short." }]);
    // The same key with the field absent stays a fieldless banner message.
    expect(localiseFlowErrorKeys("error.country_required", { ...ctx, fields: ["email"] })).toEqual([
      { message: "Country is required." },
    ]);
  });
});
