/**
 * Contract tests for the ejectable design catalog in `@zitadel/config`
 * (ADR 040): every shipped design must render through the real pipeline —
 * LiquidJS engine → DOMPurify sanitiser → `patchMandatoryGates` — and keep
 * the atoms a step needs. The authoring-side validation of the same files
 * lives in `packages/config/src/template.test.ts`.
 */
import type { CreateFlow201Step } from "@zitadel/api/generated/model";
import { BRANDING_DESIGNS, getDefaultBrandingConfig } from "@zitadel/config/defaults";
import { describe, expect, it } from "vitest";

import { createLiquidEngine } from "./liquid.js";
import { mandatoryGatesMarkerComment, patchMandatoryGates } from "./mandatory-gates.js";
import { createSanitiser } from "./sanitiser.js";

const locale: Record<string, string> = {
  "identifier.title": "Sign in",
  "identifier.field.email": "Work email",
  "identifier.field.remember": "Remember me",
  "identifier.field.department": "Department",
  "identifier.action.register.lead": "New here? ",
  "identifier.action.register.link": "Create an account",
  "submit.continue": "Continue",
  "action.recover": "Forgot password?",
  "action.back": "Back",
};

const step: CreateFlow201Step = {
  name: "identifier",
  fields: [
    { name: "email", type: "email", text_key: "identifier.field.email", required: true },
    { name: "remember", type: "checkbox", text_key: "identifier.field.remember" },
    {
      name: "department",
      type: "select",
      text_key: "identifier.field.department",
      required: true,
      validation: { enum: ["Engineering", "Support"] },
    },
  ],
  actions: [
    { name: "submit", kind: "submit", text_key: "submit.continue", primary: true },
    { name: "register", kind: "navigate", text_key: "identifier.action.register.link" },
    { name: "recover", kind: "navigate", text_key: "action.recover" },
  ],
  gates: {},
};

const context = {
  step: { name: step.name, texts: { title_key: "identifier.title" } },
  fields: step.fields,
  actions: step.actions,
  gates: [],
  messages: [],
  errors: [],
  identity: null,
  branding: {
    logo_url: "https://cdn.example.com/logo.svg",
    hero_url: "https://cdn.example.com/hero.png",
  },
  loading: false,
  challenge: null,
};

/**
 * Parses rendered HTML into a queryable fragment so attribute assertions read
 * the decoded attribute value rather than matching the serialiser's escaping
 * (`options='{...}'` comes back out as `options="{&quot;...&quot;}"`).
 */
function parseFragment(html: string): DocumentFragment {
  const element = document.createElement("template");
  element.innerHTML = html;
  return element.content;
}

function renderDesign(design: string): string {
  const engine = createLiquidEngine({ locale });
  const { template } = getDefaultBrandingConfig(design);
  const rendered = engine.parseAndRenderSync(template, context);
  const sanitised = createSanitiser()(rendered);
  return patchMandatoryGates(sanitised, step, locale);
}

describe("branding design catalog", () => {
  for (const design of BRANDING_DESIGNS) {
    describe(design, () => {
      const html = renderDesign(design);

      it("renders the declared field and primary action after the full pipeline", () => {
        expect(html).toContain('name="email"');
        expect(html).toContain('data-testid="zitadel-field-remember"');
        expect(html).toContain('data-testid="zitadel-field-department"');
        expect(html).toContain('data-testid="zitadel-action-submit"');
        expect(html).toContain('data-action="register"');
        expect(html).toContain('data-action="recover"');
      });

      it("serialises a select field's enum into the <zl-select> options attribute", () => {
        // The `{% case f.type %}` field loop is duplicated byte-identically
        // across all six templates (each design is independently ejectable per
        // ADR 037), and `select` is the one arm the shared fixture used to
        // never reach — it was only ever covered through `default.liquid`.
        const select = parseFragment(html).querySelector('zl-select[name="department"]');
        expect(select).not.toBeNull();
        expect(select?.getAttribute("label")).toBe("Department");
        expect(select?.hasAttribute("required")).toBe(true);
        expect(JSON.parse(select?.getAttribute("options") ?? "null")).toEqual([
          { value: "Engineering", label: "Engineering" },
          { value: "Support", label: "Support" },
        ]);
      });

      it("consumes its mandatory_gates marker", () => {
        expect(html).not.toContain(mandatoryGatesMarkerComment);
        // Every declared capability is rendered, so the patcher must not
        // append a second field or submit button.
        expect(html.match(/data-testid="zitadel-field-email"/g) ?? []).toHaveLength(1);
        expect(html.match(/data-testid="zitadel-action-submit"/g) ?? []).toHaveLength(1);
        // A required `select` already renders as <zl-select>; the patcher must
        // recognise it and not append a generic <zl-field> alongside.
        expect(html.match(/data-testid="zitadel-field-department"/g) ?? []).toHaveLength(1);
      });

      it("survives sanitisation structurally", () => {
        expect(html).toContain("<zl-page-shell");
      });

      it("renders no visible control for a kind: back action (gesture-only)", () => {
        const engine = createLiquidEngine({ locale });
        const { template } = getDefaultBrandingConfig(design);
        const rendered = engine.parseAndRenderSync(template, {
          ...context,
          actions: [...step.actions, { name: "back", kind: "back", text_key: "action.back" }],
        });
        const html2 = createSanitiser()(rendered);
        // Back-navigation is gesture-only (ADR 022): the template renders no
        // control for the action, and the kind-based exclusion keeps it out
        // of the secondary-button loop.
        expect(html2).not.toContain("back-action");
        expect(html2).not.toContain('data-testid="zitadel-action-back"');
      });
    });
  }

  it("split designs keep the brand pane and mirror class", () => {
    const split = renderDesign("split");
    expect(split).toContain('class="zl-split"');
    expect(split).toContain('class="zl-split__brand"');
    expect(split).toContain('src="https://cdn.example.com/hero.png"');
    expect(split).not.toContain("zl-split--right");

    const right = renderDesign("split-right");
    expect(right).toContain("zl-split--right");
  });

  it("split designs render the placeholder panel until an asset is set", () => {
    const engine = createLiquidEngine({ locale });
    const noAssets = { ...context, branding: {} };
    for (const design of ["split", "split-right"]) {
      const { template } = getDefaultBrandingConfig(design);
      const bare = createSanitiser()(engine.parseAndRenderSync(template, noAssets));
      // An empty brand pane renders the whole design as a lonely off-centre
      // card; the decorative panel must survive the sanitiser.
      expect(bare, design).toContain("zl-split__placeholder");

      const branded = createSanitiser()(engine.parseAndRenderSync(template, context));
      expect(branded, design).not.toContain("zl-split__placeholder");
    }
  });

  it("split-family designs render the mobile compact brand header", () => {
    // The chrome hides .zl-split__brand on narrow widths; the compact
    // node is the fallback that keeps the tenant's identity visible there.
    for (const design of ["split", "split-right", "hero"]) {
      expect(renderDesign(design), design).toContain('class="zl-split__compact"');
    }
  });

  it("hero_url-only tenants still get a compact fallback (banner variant)", () => {
    const engine = createLiquidEngine({ locale });
    const heroOnly = {
      ...context,
      branding: { hero_url: "https://cdn.example.com/hero.png" },
    };
    for (const design of ["split", "split-right"]) {
      const { template } = getDefaultBrandingConfig(design);
      const html = patchMandatoryGates(
        createSanitiser()(engine.parseAndRenderSync(template, heroOnly)),
        step,
        locale,
      );
      expect(html, design).toContain("zl-split__compact--hero");
      expect(html, design).toContain('src="https://cdn.example.com/hero.png"');
    }
  });

  it("hero keeps the landing pane on the split shell", () => {
    const hero = renderDesign("hero");
    expect(hero).toContain('class="zl-split"');
    expect(hero).toContain('class="zl-split__brand"');
    expect(hero).toContain('class="zl-hero"');
    expect(hero).toContain('class="zl-hero__headline"');
    expect(hero).toContain('class="zl-hero__bullets"');
    // Landing CTAs must be anchors — button/input/form are stripped by the
    // sanitiser, so a surviving <button> would mean the allowlist changed.
    expect(hero).not.toContain("<button");
  });

  it("minimal renders without card chrome", () => {
    const minimal = renderDesign("minimal");
    expect(minimal).toContain('class="zl-minimal"');
    expect(minimal).not.toContain("<zl-card");
  });

  it("centered keeps the card and header logo", () => {
    const centered = renderDesign("centered");
    expect(centered).toContain("<zl-card");
    expect(centered).toContain('src="https://cdn.example.com/logo.svg"');
  });
});
