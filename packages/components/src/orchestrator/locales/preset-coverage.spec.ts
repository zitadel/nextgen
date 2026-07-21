import {
  getDefaultLoginFlow,
  SETUP_PRESETS,
  SETUP_USE_CASES,
} from "@zitadel/config/defaults";
import { describe, expect, it } from "vitest";

import { builtinLocales } from "./index.js";

const AUTH_METHOD_PREFIX = "x-auth-methods#";

type PresetFlow = {
  purposes?: Record<string, string>;
  steps?: Array<{
    name: string;
    fields?: string[];
    actions?: Array<{ name: string; text_key?: string }>;
    complete?: string;
  }>;
};

/**
 * Every text key a shipped preset flow can produce must resolve in every
 * builtin locale — otherwise a fresh `zitadel setup --preset … --use-case …`
 * renders raw keys in the login UI. The register step's fields vary by use
 * case (e.g. `business` adds `companyName`), so the matrix iterates every
 * (use case × preset) pair. Key derivation mirrors the engine
 * (`flow_state_machine.go` buildStep + the field resolver): step titles and
 * descriptions, action labels (explicit `text_key` or
 * `<step>.action.<name>`), field labels (`<step>.field.<field>`, auth-method
 * tokens labelled by method), and the injected back action (step-specific
 * key or the generic `action.back` fallback).
 */
describe.each(
  SETUP_USE_CASES.flatMap((useCase) => SETUP_PRESETS.map((preset) => ({ useCase, preset }))),
)("use case $useCase, preset $preset locale coverage", ({ useCase, preset }) => {
  const flow = getDefaultLoginFlow({ preset, useCase, userSchemaUrl: "sch_TEST" }) as PresetFlow;
  const steps = flow.steps ?? [];

  describe.each(Object.entries(builtinLocales))("locale %s", (_lang, locale) => {
    it("resolves every step title and description", () => {
      for (const step of steps) {
        expect(locale, `${step.name}.title`).toHaveProperty(`${step.name}.title`);
        if (step.complete === undefined) {
          expect(locale, `${step.name}.description`).toHaveProperty(
            `${step.name}.description`,
          );
        }
      }
    });

    it("resolves every action label", () => {
      for (const step of steps) {
        for (const action of step.actions ?? []) {
          const key = action.text_key ?? `${step.name}.action.${action.name}`;
          expect(locale, key).toHaveProperty(key);
        }
      }
    });

    it("resolves every field label", () => {
      for (const step of steps) {
        for (const field of step.fields ?? []) {
          const label = field.startsWith(AUTH_METHOD_PREFIX)
            ? field.slice(AUTH_METHOD_PREFIX.length)
            : field;
          const key = `${step.name}.field.${label}`;
          expect(locale, key).toHaveProperty(key);
        }
      }
    });

    it("resolves the injected back action on every non-terminal step", () => {
      for (const step of steps) {
        if (step.complete !== undefined) continue;
        const resolved =
          locale[`${step.name}.action.back`] ?? locale["action.back"];
        expect(resolved, `${step.name}.action.back`).toBeDefined();
      }
    });
  });
});
