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

  it("normalises the auth-method credential name in the input testid", async () => {
    const field = mount(
      `<zl-field name="x-auth-methods#password" type="password" data-testid="zitadel-field-password"></zl-field>`,
    );
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    // The hook is method-named; the form key stays raw.
    expect(input.getAttribute("data-testid")).toBe("zitadel-input-password");
    expect(input.getAttribute("name")).toBe("x-auth-methods#password");
  });

  it("labels the input and marks a required field", async () => {
    const field = mount(`<zl-field name="email" label="Email" required></zl-field>`);
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    const label = field.shadowRoot?.querySelector("label") as HTMLLabelElement;
    expect(label.getAttribute("for")).toBe(input.id);
    expect(label.textContent).toContain("Email");
    expect(label.querySelector(".zr-field__required")?.getAttribute("aria-hidden")).toBe("true");
    expect(input.hasAttribute("aria-label")).toBe(false);
  });

  it("falls back to aria-label when there is no visible label", async () => {
    const field = mount(`<zl-field name="code" aria-label="One-time code"></zl-field>`);
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(field.shadowRoot?.querySelector("label")).toBeNull();
    expect(input.getAttribute("aria-label")).toBe("One-time code");
  });

  it("emits zl-submit with the action when the forgot-password link runs one", async () => {
    const field = mount(
      `<zl-field name="password" label="Password" forgot-password-href="#" forgot-password-action="forgot_password"></zl-field>`,
    );
    await field.updateComplete;
    let detail: unknown;
    field.addEventListener("zl-submit", (event) => {
      detail = event.detail;
    });
    const link = field.shadowRoot?.querySelector(".zr-field__link") as HTMLAnchorElement;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(detail).toEqual({ action: "forgot_password" });
  });

  it("leaves the forgot-password link a plain navigation without an action", async () => {
    const field = mount(
      `<zl-field name="password" label="Password" forgot-password-href="#recover"></zl-field>`,
    );
    await field.updateComplete;
    let submits = 0;
    field.addEventListener("zl-submit", () => {
      submits += 1;
    });
    const link = field.shadowRoot?.querySelector(".zr-field__link") as HTMLAnchorElement;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(submits).toBe(0);
  });

  it("swaps the trailing icon for the error and success states", async () => {
    const field = mount(`<zl-field name="email"></zl-field>`);
    await field.updateComplete;
    const trailingIcon = () =>
      field.shadowRoot?.querySelector(".zr-field__trailing zl-icon")?.getAttribute("name");
    expect(trailingIcon()).toBe("cross");
    expect(field.shadowRoot?.querySelector(".zr-field__trailing-action")).toBeTruthy();

    field.error = "Bad address";
    await field.updateComplete;
    expect(trailingIcon()).toBe("alert-circle");
    expect(field.shadowRoot?.querySelector(".zr-field__trailing-action")).toBeNull();

    field.error = "";
    field.success = "Looks good";
    await field.updateComplete;
    expect(trailingIcon()).toBe("check");
  });

  it("shows the success message only when the field is not in error", async () => {
    const field = mount(`<zl-field name="email" success="Looks good"></zl-field>`);
    await field.updateComplete;
    const success = field.shadowRoot?.querySelector(".zr-field__success") as HTMLElement;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(success.hidden).toBe(false);
    expect(input.getAttribute("aria-describedby")).toMatch(/-success$/);

    field.error = "Bad address";
    await field.updateComplete;
    expect(success.hidden).toBe(true);
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

describe("<zl-field> password toggle", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(html: string, props: Partial<ZlField> = {}): Promise<ZlField> {
    host.innerHTML = html;
    const field = host.querySelector("zl-field") as ZlField;
    Object.assign(field, props);
    await field.updateComplete;
    return field;
  }

  const input = (field: ZlField) => field.shadowRoot?.querySelector("input") as HTMLInputElement;
  const toggle = (field: ZlField) =>
    field.shadowRoot?.querySelector<HTMLButtonElement>('[part~="password-toggle"]') ?? null;

  it("is off unless the property is set", async () => {
    const field = await mount(`<zl-field name="pw" type="password"></zl-field>`);
    expect(toggle(field)).toBeNull();
    expect(input(field).hasAttribute("spellcheck")).toBe(false);
  });

  it("cannot be switched on from markup", async () => {
    const field = await mount(`<zl-field name="pw" type="password" password-toggle></zl-field>`);
    expect(field.passwordToggle).toBe(false);
    expect(toggle(field)).toBeNull();
  });

  it("ignores the property on a non-password field", async () => {
    const field = await mount(`<zl-field name="email" type="email"></zl-field>`, {
      passwordToggle: true,
    });
    expect(toggle(field)).toBeNull();
  });

  it("replaces the clear button, so the field shows one icon", async () => {
    const field = await mount(`<zl-field name="pw" type="password" value="hunter2"></zl-field>`, {
      passwordToggle: true,
    });
    const actions = field.shadowRoot?.querySelectorAll('[part~="trailing-action"]') ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.getAttribute("aria-label")).toBe("Show password");
  });

  it("keeps the toggle in the error state instead of the alert icon", async () => {
    const field = await mount(`<zl-field name="pw" type="password" error="Wrong"></zl-field>`, {
      passwordToggle: true,
    });
    expect(toggle(field)).not.toBeNull();
    expect(field.shadowRoot?.querySelector('zl-icon[name="alert-circle"]')).toBeNull();
  });

  it("reveals and hides the value, keeping it out of the tab order", async () => {
    const field = await mount(`<zl-field name="pw" type="password" value="hunter2"></zl-field>`, {
      passwordToggle: true,
      showPasswordLabel: "Anzeigen",
      hidePasswordLabel: "Verbergen",
    });
    const button = toggle(field)!;
    expect(button.tabIndex).toBe(-1);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(input(field).type).toBe("password");

    button.click();
    await field.updateComplete;
    expect(input(field).type).toBe("text");
    expect(input(field).value).toBe("hunter2");
    expect(toggle(field)!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle(field)!.getAttribute("aria-label")).toBe("Verbergen");

    toggle(field)!.click();
    await field.updateComplete;
    expect(input(field).type).toBe("password");
    expect(toggle(field)!.getAttribute("aria-label")).toBe("Anzeigen");
  });

  it("opts the input out of spellcheck and autocorrect", async () => {
    const field = await mount(`<zl-field name="pw" type="password"></zl-field>`, {
      passwordToggle: true,
    });
    expect(input(field).getAttribute("spellcheck")).toBe("false");
    expect(input(field).getAttribute("autocapitalize")).toBe("off");
    expect(input(field).getAttribute("autocorrect")).toBe("off");
  });

  it("hides the value again when the toggle is withdrawn", async () => {
    const field = await mount(`<zl-field name="pw" type="password"></zl-field>`, {
      passwordToggle: true,
    });
    toggle(field)!.click();
    await field.updateComplete;
    field.passwordToggle = false;
    await field.updateComplete;
    expect(input(field).type).toBe("password");
    field.passwordToggle = true;
    await field.updateComplete;
    expect(input(field).type).toBe("password");
  });

  it("hides the value again on form reset", async () => {
    const field = await mount(`<zl-field name="pw" type="password"></zl-field>`, {
      passwordToggle: true,
    });
    toggle(field)!.click();
    await field.updateComplete;
    field.formResetCallback();
    await field.updateComplete;
    expect(input(field).type).toBe("password");
  });
});
