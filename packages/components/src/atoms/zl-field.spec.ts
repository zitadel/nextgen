import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-field.js";
import type { ZlField } from "./zl-field.js";

/**
 * jsdom-friendly behaviour for `<zl-field>`. Form-associated semantics
 * (`setFormValue`, `setValidity`, `internals.form`, Enter-to-submit) live in
 * `zl-field.browser.spec.ts` and run in real Chromium via Vitest browser
 * mode — jsdom 29 only ships a partial implementation.
 */
describe("<zl-field> aria wiring", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(html: string): ZlField {
    host.innerHTML = html;
    return host.querySelector("zl-field") as ZlField;
  }

  it("does not point aria-describedby at empty help/error nodes", async () => {
    const field = mount(`<zl-field name="email"></zl-field>`);
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });

  it("references the error id once the field is in error", async () => {
    const field = mount(`<zl-field name="email" error="Bad address"></zl-field>`);
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toMatch(/-error$/);
  });

  it("reads formValue from the live input so autofill is captured", async () => {
    const field = mount(`<zl-field name="email" value="typed@acme.com"></zl-field>`);
    await field.updateComplete;
    expect(field.formValue).toBe("typed@acme.com");
    // Simulate autofill writing the native input directly, bypassing `value`.
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    input.value = "autofilled@acme.com";
    expect(field.formValue).toBe("autofilled@acme.com");
  });

  it("syncs the native input when formValue is assigned", async () => {
    const field = mount(`<zl-field name="email"></zl-field>`);
    await field.updateComplete;
    field.formValue = "restored@acme.com";
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(field.value).toBe("restored@acme.com");
    expect(input.value).toBe("restored@acme.com");
  });
});
