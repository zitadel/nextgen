import { describe, expect, it } from "vitest";

import { validateLiquidTemplate } from "../../src/templates/validate";

describe("liquid template validation", () => {
  it("rejects templates using the | raw filter", () => {
    const source = `<div>{{ value | raw }}</div>`;
    const result = validateLiquidTemplate(source);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.some((i) => i.rule === "banned-filter")).toBe(true);
  });

  it("rejects templates with <script> tags", () => {
    const source = `<div>{{ value }}</div>\n<script>alert(1)</script>`;
    const result = validateLiquidTemplate(source);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.some((i) => i.rule === "banned-tag")).toBe(true);
  });

  it("rejects templates with inline event handlers", () => {
    const source = `<img src="x" onerror="steal()" />`;
    const result = validateLiquidTemplate(source);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.some((i) => i.rule === "banned-attribute")).toBe(true);
  });

  it("accepts <zl-*> components and standard liquid tags", () => {
    const source = `<zl-field name="email" label="{{ 'identifier.field.email' | t }}"></zl-field>\n{% if sso_providers.size > 0 %}<zl-sso></zl-sso>{% endif %}`;
    const result = validateLiquidTemplate(source);
    expect(result.valid, result.valid ? "" : JSON.stringify(result.issues)).toBe(true);
  });
});
