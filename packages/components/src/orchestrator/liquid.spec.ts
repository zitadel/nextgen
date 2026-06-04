import { describe, expect, it } from "vitest";

import { createLiquidEngine } from "./liquid.js";
import { TEMPLATE_NAMES } from "./template-names.js";
import { en as fullLocale } from "./locales/en.js";
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";

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
    const context = {
      step: { name: "identifier", type: "identifier", texts: { title_key: "identifier.title" } },
      fields: {
        identifier: { type: "email", text_key: "identifier.title", required: true },
      },
      actions: { submit: { text_key: "submit.continue", primary: true } },
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
    expect(result).toContain('<zl-button');
    expect(result).toContain('hierarchy="primary"');
    expect(result).toContain(mandatoryGatesMarkerComment);
  });

  it("renders step title from locale via default template", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "password", texts: { title_key: "password.title" } },
      fields: {},
      actions: { submit: { text_key: "submit.continue", primary: true } },
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

  it("renders passkey upsell (6594:630): compact card, copy, trailing icon, skip CTA", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const context = {
      step: { name: "passkey-upsell", texts: { title_key: "passkey-upsell.title" } },
      fields: {},
      actions: {
        setup: { text_key: "passkey-upsell.action.setup", primary: true },
        skip: { text_key: "passkey-upsell.action.skip" },
      },
      branding: {},
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("compact");
    expect(result).toContain("Sign in faster next time");
    expect(result).toContain("No password needed ever again.");
    expect(result).toContain("Sign in with Face ID, Touch ID, or PIN.");
    expect(result).toContain('slot="trailing"');
    expect(result).toContain('name="passkey"');
    expect(result).toContain('action="setup"');
    expect(result).toContain('action="skip"');
    expect(result).toContain('hierarchy="secondary"');
    expect(result).toContain('type="button"');
    expect(result).toContain('label="Skip for now"');
    expect(result).not.toContain("<zl-field");
  });

  it("renders passkey upsell setup error (6594:630): form-level alert, retry allowed", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const context = {
      step: { name: "passkey-upsell", texts: { title_key: "passkey-upsell.title" } },
      fields: {},
      actions: {
        setup: { text_key: "passkey-upsell.action.setup", primary: true },
        skip: { text_key: "passkey-upsell.action.skip" },
      },
      branding: {},
      loading: false,
      errors: [{ text_key: "error.passkey_cancelled" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('<zl-alert severity="error">');
    expect(result).toContain("Passkey setup was cancelled");
    expect(result).toContain('action="setup"');
    expect(result).not.toContain("invalid");
  });

  it("renders the signed-in partial when the step is the signed-in confirmation", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "signed-in", texts: { title_key: "complete.title" } },
      fields: {},
      actions: {},
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
    expect(result).toContain("alice@acme.com");
    expect(result).not.toContain("zl-signed-in-hero");
  });

  it("renders combined sign-in (6593:141983): email+password, forgot link, sign-in CTA", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: {
        email: { type: "email", text_key: "identifier.field.email", required: true },
        password: { type: "password", text_key: "identifier.field.password", required: true },
      },
      actions: {
        submit: { text_key: "submit.signin", primary: true },
        passkey: { text_key: "identifier.action.passkey" },
        register: { text_key: "identifier.action.register.link" },
        recover: { text_key: "action.forgot_password" },
      },
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
  });

  it("renders sign-in wrong credentials (6602:180268): inline password error, no form alert", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: {
        email: { type: "email", text_key: "identifier.field.email", required: true },
        password: { type: "password", text_key: "identifier.field.password", required: true },
      },
      actions: {
        submit: { text_key: "submit.signin", primary: true },
        recover: { text_key: "action.forgot_password" },
      },
      branding: {},
      loading: false,
      errors: [{ text_key: "error.invalid_credentials" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("Wrong email or password.");
    expect(result).toContain('name="password"');
    expect(result).toContain('invalid');
    expect(result).not.toContain('<zl-alert severity="error">Wrong email');
    expect(result).not.toContain('<zl-alert severity="error"');
  });

  it("renders sign-in server error (6594:125237): heading + body alert, fields unchanged", () => {
    const engine = createLiquidEngine({ locale: fullLocale });
    const context = {
      step: { name: "identifier", texts: { title_key: "identifier.title" } },
      fields: {
        email: { type: "email", text_key: "identifier.field.email", required: true },
        password: { type: "password", text_key: "identifier.field.password", required: true },
      },
      actions: {
        submit: { text_key: "submit.signin", primary: true },
        recover: { text_key: "action.forgot_password" },
      },
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
    const context = {
      step: { name: "register", texts: { title_key: "register.title" } },
      fields: {
        email: { type: "email", text_key: "register.field.email", required: true },
        password: { type: "password", text_key: "register.field.password", required: true },
      },
      actions: {
        submit: { text_key: "register.action.submit", primary: true },
      },
      branding: {},
      loading: false,
      errors: [{ text_key: "error.email_exists" }],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain('autocomplete="email"');
    expect(result).toContain('autocomplete="new-password"');
    expect(result).toContain("At least 8 characters");
    expect(result).toContain("An account with this email already exists");
    expect(result).not.toContain("forgot-password-href");
    expect(result).not.toContain('<zl-alert severity="error">An account');
    expect(result).not.toContain("forgot-password-href");
    expect(result).not.toContain('data-action="sign_in"');
    expect(result).not.toContain('class="zl-card-nav"');
    expect(result).toContain('label="Sign up"');
    expect(result).not.toContain('compact');
  });

  it("renders the signed-in partial when the API returns a terminal step (complete: show)", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "done", complete: "show", texts: { title_key: "complete.title" } },
      fields: {},
      actions: {},
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
    expect(result).toContain("qwertz@acme.com");
  });
});
