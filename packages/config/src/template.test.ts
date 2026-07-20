import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BRANDING_DESIGNS, getDefaultBrandingConfig } from "./defaults.js";
import {
  MAX_TEMPLATE_BYTES,
  type TemplateValidationRuleId,
  validateLoginTemplate,
} from "./template.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const componentsDefaultTemplate = join(
  packageRoot,
  "../..",
  "packages/components/src/orchestrator/templates/default.liquid",
);

const VALID_TEMPLATE = `<div>{% for f in fields %}<zl-field name="{{ f.name }}"></zl-field>{% endfor %}{% mandatory_gates %}</div>`;

function rules(template: string): TemplateValidationRuleId[] {
  return validateLoginTemplate(template).map((issue) => issue.rule);
}

describe("validateLoginTemplate", () => {
  it("accepts a well-formed template", () => {
    expect(validateLoginTemplate(VALID_TEMPLATE)).toEqual([]);
  });

  it("rejects invalid Liquid syntax", () => {
    expect(rules(`{% if foo %}unclosed{% mandatory_gates %}`)).toContain("parse");
  });

  it("requires the mandatory_gates tag", () => {
    expect(rules(`<div>hello</div>`)).toContain("mandatory-gates");
  });

  it("rejects script tags", () => {
    expect(rules(`<SCRIPT src="x"></SCRIPT>{% mandatory_gates %}`)).toContain("no-script-tag");
  });

  it("rejects style tags", () => {
    expect(rules(`<style>:host{}</style>{% mandatory_gates %}`)).toContain("no-style-tag");
  });

  it("rejects inline event handlers inside tags", () => {
    expect(rules(`<img src=x onerror=steal()>{% mandatory_gates %}`)).toContain(
      "no-inline-handlers",
    );
  });

  it("rejects slash-separated inline handlers (HTML treats / as whitespace)", () => {
    expect(rules(`<img/onerror=alert(1)>{% mandatory_gates %}`)).toContain("no-inline-handlers");
  });

  it("does not flag liquid assignments that resemble handlers", () => {
    expect(rules(`{% assign online = true %}{% mandatory_gates %}`)).toEqual([]);
  });

  it("rejects javascript: URLs", () => {
    expect(rules(`<a href="javascript:alert(1)">x</a>{% mandatory_gates %}`)).toContain(
      "no-javascript-urls",
    );
  });

  it("rejects the raw filter but not raw-prefixed names", () => {
    expect(rules(`{{ x | raw }}{% mandatory_gates %}`)).toContain("no-raw-filter");
    expect(rules(`{{ x | rawr }}{% mandatory_gates %}`)).not.toContain("no-raw-filter");
  });

  it("rejects oversized templates", () => {
    const filler = `{% mandatory_gates %}` + "a".repeat(MAX_TEMPLATE_BYTES);
    expect(rules(filler)).toContain("size");
  });
});

describe("branding designs", () => {
  it("every shipped design passes the authoritative validator", () => {
    for (const design of BRANDING_DESIGNS) {
      const { template } = getDefaultBrandingConfig(design);
      expect(validateLoginTemplate(template), design).toEqual([]);
    }
  });

  it("designs map to a degrade layout and reference the sibling template file", () => {
    for (const design of BRANDING_DESIGNS) {
      const { branding } = getDefaultBrandingConfig(design);
      expect(["centered", "split"]).toContain(branding.layout);
      expect(branding.liquid_template_file).toBe("./login.liquid");
    }
  });

  it("rejects unknown designs", () => {
    expect(() => getDefaultBrandingConfig("brutalist")).toThrow(/unknown branding design/);
  });

  // Drift audit: the `centered` design is the ejected form of the bundled
  // default and must stay byte-identical to the template
  // @zitadel/components ships. Skipped outside the monorepo.
  it.skipIf(!existsSync(componentsDefaultTemplate))(
    "the centered design matches the bundled default template",
    () => {
      const bundled = readFileSync(componentsDefaultTemplate, "utf8");
      expect(getDefaultBrandingConfig("centered").template).toBe(bundled);
    },
  );
});
