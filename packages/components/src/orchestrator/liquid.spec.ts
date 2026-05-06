import { describe, expect, it } from "vitest";

import { createLiquidEngine, TEMPLATE_NAMES } from "./liquid.js";
import { mandatoryGatesMarkerComment } from "./mandatory-gates.js";

const locale: Record<string, string> = {
  "identifier.title": "Sign in",
  "password.title": "Welcome back, {0}",
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

  it("the | t filter interpolates positional args", () => {
    const engine = createLiquidEngine({ locale });
    const result = engine.parseAndRenderSync(`{{ "password.title" | t: "Alice" }}`, {});
    expect(result).toBe("Welcome back, Alice");
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

  it("renders the bundled default template", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "identifier", type: "identifier", texts: { title_key: "identifier.title" } },
      fields: {
        identifier: { type: "email", text_key: "identifier.title", required: true },
      },
      actions: { submit: { text_key: "submit.continue", primary: true } },
      branding: { layout: "centered" },
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("zl-layout--centered");
    expect(result).toContain("<zl-field");
    expect(result).toContain("<zl-submit");
    expect(result).toContain(mandatoryGatesMarkerComment);
  });

  it("forwards identity.display_name to step.texts.title_key", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "password", type: "credential", texts: { title_key: "password.title" } },
      fields: {},
      actions: { submit: { text_key: "submit.continue", primary: true } },
      branding: { layout: "centered" },
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: { display_name: "Alice" },
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("Welcome back, Alice");
    expect(result).not.toContain("{0}");
  });

  it("renders the split layout when branding.layout is split", () => {
    const engine = createLiquidEngine({ locale });
    const context = {
      step: { name: "identifier", type: "identifier", texts: { title_key: "identifier.title" } },
      fields: {},
      actions: { submit: { text_key: "submit.continue", primary: true } },
      branding: { layout: "split", hero_url: "https://cdn.example.com/hero.jpg" },
      loading: false,
      errors: [],
      gates: {},
      sso_providers: [],
      messages: [],
      identity: null,
    };
    const result = engine.renderFileSync(TEMPLATE_NAMES.default, context);
    expect(result).toContain("zl-layout--split");
    expect(result).toContain("zl-layout-hero");
  });
});
