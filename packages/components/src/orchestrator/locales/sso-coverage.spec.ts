import { describe, expect, it } from "vitest";

import { builtinLocales } from "./index.js";

/**
 * The steps `zitadel sso enable` adds to a login flow, as the engine renders
 * them.
 *
 * A fixture rather than a call into the CLI's generator: this package
 * consumes the *rendered* step the server sends, and the authoring side that
 * writes the flow file is the CLI's business. The shapes are pinned by
 * `flow-step.yaml` either way, and the CLI has its own test asserting the
 * generator produces exactly these names.
 *
 * Its purpose is the same as `preset-coverage.spec.ts`: every key these steps
 * can produce must resolve in every builtin locale, or a project that enables
 * a provider shows raw keys where its sign-in copy should be.
 */
const SSO_STEPS = [
  {
    name: "register-sso",
    fields: ["email"],
    actions: [{ name: "submit", text_key: "register-sso.action.submit" }],
  },
  {
    name: "sso-conflict",
    fields: ["password"],
    actions: [
      { name: "submit", text_key: "sso-conflict.action.submit" },
      { name: "passkey", text_key: "sso-conflict.action.passkey" },
      { name: "sign_in", text_key: "sso-conflict.action.sign_in" },
    ],
  },
] as const;

/** Copy the provider button itself needs, which no step declares. */
const PROVIDER_KEYS = ["sso.continue_with", "sso.divider", "sso.redirect.title"] as const;

describe.each(Object.entries(builtinLocales))("locale %s covers the sso steps", (_lang, locale) => {
  it("resolves the provider button copy", () => {
    for (const key of PROVIDER_KEYS) {
      expect(locale, key).toHaveProperty(key);
    }
  });

  it("keeps the vendor placeholder in the button label", () => {
    // `<zl-sso-providers>` substitutes `{name}`; a translation that drops it
    // would render the same label for every provider.
    expect(locale["sso.continue_with"]).toContain("{name}");
  });

  it.each(SSO_STEPS)("resolves every key step $name produces", (step) => {
    expect(locale, `${step.name}.title`).toHaveProperty(`${step.name}.title`);
    expect(locale, `${step.name}.description`).toHaveProperty(`${step.name}.description`);
    for (const field of step.fields) {
      expect(locale, `${step.name}.field.${field}`).toHaveProperty(`${step.name}.field.${field}`);
    }
    for (const action of step.actions) {
      expect(locale, action.text_key).toHaveProperty(action.text_key);
    }
    // Every non-terminal step gets a back action injected by the engine.
    const back = locale[`${step.name}.action.back`] ?? locale["action.back"];
    expect(back, `${step.name}.action.back`).toBeDefined();
  });
});
