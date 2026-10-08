import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-checkbox.js";
import type { ZlCheckbox, ZlCheckboxChangeDetail } from "./zl-checkbox.js";

/**
 * Real-browser checks for the form-participation contract documented in
 * `docs/design/branding/form-participation.md`. These rely on the full
 * Form-Associated Custom Element API (setFormValue / setValidity /
 * formResetCallback / delegatesFocus), which jsdom 29 only partially
 * implements. Run via `pnpm test:browser`.
 */
describe("<zl-checkbox> form participation (chromium)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(html: string): { form: HTMLFormElement; checkbox: ZlCheckbox } {
    host.innerHTML = html;
    return {
      form: host.querySelector("form") as HTMLFormElement,
      checkbox: host.querySelector("zl-checkbox") as ZlCheckbox,
    };
  }

  it("contributes its value to FormData only when checked", async () => {
    const { form, checkbox } = mount(
      `<form><zl-checkbox name="terms" value="yes"></zl-checkbox></form>`,
    );
    await checkbox.updateComplete;
    expect(new FormData(form).get("terms")).toBeNull();
    checkbox.checked = true;
    await checkbox.updateComplete;
    expect(new FormData(form).get("terms")).toBe("yes");
  });

  it("flags valueMissing when required and unchecked", async () => {
    const { form, checkbox } = mount(
      `<form><zl-checkbox name="terms" required></zl-checkbox></form>`,
    );
    await checkbox.updateComplete;
    expect(form.checkValidity()).toBe(false);
    checkbox.checked = true;
    await checkbox.updateComplete;
    expect(form.checkValidity()).toBe(true);
  });

  it("syncs the native change into host.checked, FormData and zl-change", async () => {
    const { form, checkbox } = mount(
      `<form><zl-checkbox name="terms" value="on"></zl-checkbox></form>`,
    );
    await checkbox.updateComplete;
    let detail: ZlCheckboxChangeDetail | undefined;
    let nativeChanges = 0;
    checkbox.addEventListener("zl-change", (event) => {
      detail = (event as CustomEvent<ZlCheckboxChangeDetail>).detail;
    });
    checkbox.addEventListener("change", () => {
      nativeChanges += 1;
    });

    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await checkbox.updateComplete;

    expect(checkbox.checked).toBe(true);
    expect(new FormData(form).get("terms")).toBe("on");
    expect(detail).toEqual({ name: "terms", checked: true, value: "on" });
    expect(nativeChanges).toBe(1);
  });

  it("restores the default checked state when the host form is reset", async () => {
    const { form, checkbox } = mount(
      `<form><zl-checkbox name="terms" checked></zl-checkbox></form>`,
    );
    await checkbox.updateComplete;
    checkbox.checked = false;
    await checkbox.updateComplete;
    form.reset();
    await checkbox.updateComplete;
    expect(checkbox.checked).toBe(true);
  });

  it("keeps the default from its first connect when moved in the DOM", async () => {
    // `checked` reflects to the attribute, so re-reading the markup on every
    // connect would turn the user's tick into the default.
    const { form, checkbox } = mount(
      `<form><div class="a"><zl-checkbox name="terms"></zl-checkbox></div><div class="b"></div></form>`,
    );
    await checkbox.updateComplete;
    checkbox.checked = true;
    await checkbox.updateComplete;
    (form.querySelector(".b") as HTMLDivElement).append(checkbox);
    await checkbox.updateComplete;
    form.reset();
    await checkbox.updateComplete;
    expect(checkbox.checked).toBe(false);
  });

  it("is disabled by an enclosing fieldset", async () => {
    const { form, checkbox } = mount(
      `<form><fieldset disabled><zl-checkbox name="terms" checked></zl-checkbox></fieldset></form>`,
    );
    await checkbox.updateComplete;
    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(new FormData(form).get("terms")).toBeNull();

    (form.querySelector("fieldset") as HTMLFieldSetElement).disabled = false;
    await checkbox.updateComplete;
    expect(input.disabled).toBe(false);
    expect(new FormData(form).get("terms")).toBe("on");
  });

  it("delegates focus from the host to the inner input", async () => {
    const { checkbox } = mount(`<form><zl-checkbox name="terms"></zl-checkbox></form>`);
    await checkbox.updateComplete;
    checkbox.focus();
    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(checkbox.shadowRoot?.activeElement).toBe(input);
  });
});
