import { describe, expect, it } from "vitest";

import { renderDefaultTemplate } from "./default-template.js";
import { createLiquidEngine, TEMPLATE_NAMES } from "./liquid.js";
import { en } from "./locales/en.js";
import { builtinLocales } from "./locales/index.js";
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";
import { createTemplateFilters } from "./template-filters.js";
import type { LiquidContext } from "./template-context.js";

/**
 * A context with nothing on it; each case below adds what it exercises.
 */
const empty: LiquidContext = {
  step: { name: "identifier", texts: { title_key: "identifier.title" } },
  fields: [],
  actions: [],
  gates: {},
  sso_providers: [],
  challenge: null,
  identifier: null,
  messages: [],
  identity: null,
  errors: [],
  branding: {},
  loading: false,
  pending_action: null,
};

const passwordStep: LiquidContext = {
  ...empty,
  step: {
    name: "password",
    texts: { title_key: "password.title", description_key: "password.description" },
  },
  identity: { display_name: "Ada <Lovelace>" } as LiquidContext["identity"],
  identifier: { value: "ada@example.com" } as LiquidContext["identifier"],
  fields: [
    {
      name: "x-auth-methods#password",
      type: "password",
      text_key: "password.field.password",
      autocomplete: "current-password",
      required: true,
    },
  ] as LiquidContext["fields"],
  actions: [
    { name: "continue", kind: "submit", text_key: "identifier.action.continue", primary: true },
    { name: "back", kind: "back", text_key: "password.action.back" },
    { name: "recover", kind: "navigate", text_key: "action.forgot_password" },
    { name: "passkey", kind: "passkey", text_key: "password.action.passkey" },
  ] as LiquidContext["actions"],
};

/**
 * Contexts that between them take every branch of `default.liquid`.
 */
const cases: ReadonlyArray<[string, LiquidContext]> = [
  ["an empty step", empty],
  ["a password step with an account chip and recovery", passwordStep],
  [
    "a password step while its primary action is pending",
    { ...passwordStep, loading: true, pending_action: "continue" },
  ],
  [
    "a password step loading with no single control behind it",
    { ...passwordStep, loading: true, pending_action: null },
  ],
  [
    "a blank identifier",
    { ...passwordStep, identifier: { value: "   " } as LiquidContext["identifier"] },
  ],
  [
    "a step that signs in elsewhere, so the chip is static",
    {
      ...passwordStep,
      actions: [
        ...passwordStep.actions,
        { name: "sign_in", kind: "navigate", text_key: "password.action.signin" },
      ] as LiquidContext["actions"],
    },
  ],
  [
    "a register step with every field kind, values and inline errors",
    {
      ...empty,
      step: { name: "register", texts: { title_key: "register.title" } },
      fields: [
        {
          name: "email",
          type: "email",
          text_key: "register.field.email",
          value: `"quoted" & <tagged>`,
          autocomplete: "username",
          required: true,
        },
        {
          name: "x-auth-methods#password",
          type: "password",
          text_key: "register.field.password",
          autocomplete: "new-password",
          validation: { min_length: 12 },
        },
        {
          name: "country",
          type: "select",
          text_key: "register.field.country",
          value: "CH",
          required: true,
          validation: { enum: ["CH", "DE", "It's"] },
        },
        { name: "terms", type: "checkbox", text_key: "register.field.terms", value: true },
        { name: "nickname", type: "text", text_key: "register.field.nickname", read_only: true },
      ] as LiquidContext["fields"],
      errors: [
        { field: "email", text_key: "error.email_exists" },
        { field: "country", message: "Country is required." },
      ],
      actions: [
        { name: "register", kind: "submit", text_key: "register.action.submit", primary: true },
        { name: "sign_in", kind: "navigate", text_key: "register.action.sign_in.link" },
      ] as LiquidContext["actions"],
      identifier: { value: "ada@example.com" } as LiquidContext["identifier"],
    },
  ],
  [
    "form-level errors with heading, body, detail and link",
    {
      ...empty,
      errors: [
        { text_key: "error.sign_in_server" },
        { text_key: "error.invalid_credentials" },
        {
          message: "Plain <message>",
          detail: "Provider said no",
          uri: "https://example.com/?a=1&b=2",
        },
      ],
    },
  ],
  [
    "a notice, providers and the identifier step's own links",
    {
      ...empty,
      messages: [{ level: "info", text_key: "notice.user_not_found" }],
      sso_providers: [
        { id: "google", name: "Google", template: "google" },
        { id: "o'reilly", name: "O'Reilly & Co", template: "generic" },
      ] as LiquidContext["sso_providers"],
      actions: [
        { name: "continue", kind: "submit", text_key: "identifier.action.continue", primary: true },
        { name: "register", kind: "navigate", text_key: "identifier.action.register.link" },
        { name: "help", kind: "navigate", text_key: "action.cancel" },
      ] as LiquidContext["actions"],
      loading: true,
      pending_action: "help",
    },
  ],
  [
    "a passkey challenge",
    {
      ...empty,
      challenge: {
        method: "passkey",
        challenge_id: "c1",
        options: { challenge: "abc", rpId: "example.com" },
      } as LiquidContext["challenge"],
      actions: [
        { name: "passkey", kind: "submit", text_key: "password.action.passkey", primary: true },
      ] as LiquidContext["actions"],
    },
  ],
  [
    "a passkey challenge that registers a user",
    {
      ...empty,
      challenge: {
        method: "passkey",
        challenge_id: "c2",
        options: { user: { id: "u1", name: "ada" } },
      } as LiquidContext["challenge"],
    },
  ],
  [
    "a passkey registration challenge",
    {
      ...empty,
      challenge: {
        method: "passkey_register",
        challenge_id: "c3",
        options: {},
      } as LiquidContext["challenge"],
    },
  ],
  [
    "a challenge without a method",
    {
      ...empty,
      challenge: { challenge_id: "c4", options: {} } as LiquidContext["challenge"],
    },
  ],
  [
    "a terminal step with a logo",
    {
      ...empty,
      step: { name: "complete", complete: "show", texts: { title_key: "complete.title" } },
      branding: { logo_url: "https://example.com/logo.svg?x=1&y=2" } as LiquidContext["branding"],
    },
  ],
];

describe("renderDefaultTemplate", () => {
  it.each(cases)("renders %s byte for byte as the Liquid engine does", (_name, context) => {
    const locale = en;

    const compiled = renderDefaultTemplate(context, createTemplateFilters(locale));
    const engine = createLiquidEngine({ locale }).renderFileSync(TEMPLATE_NAMES.default, context);

    expect(compiled).toBe(engine);
  });

  it.each(Object.entries(builtinLocales))(
    "renders the password step in %s as the Liquid engine does",
    (_language, locale) => {
      const compiled = renderDefaultTemplate(passwordStep, createTemplateFilters(locale));
      const engine = createLiquidEngine({ locale }).renderFileSync(
        TEMPLATE_NAMES.default,
        passwordStep,
      );

      expect(compiled).toBe(engine);
    },
  );

  it("emits the mandatory gates marker", () => {
    expect(renderDefaultTemplate(empty, createTemplateFilters(en))).toContain(
      mandatoryGatesMarkerComment,
    );
  });

  it("escapes the values it writes into attributes", () => {
    const context = {
      ...passwordStep,
      identifier: { value: `"ada" <a&b>` } as LiquidContext["identifier"],
    };

    expect(renderDefaultTemplate(context, createTemplateFilters(en))).toContain(
      `identifier="&#34;ada&#34; &lt;a&amp;b&gt;"`,
    );
  });
});
