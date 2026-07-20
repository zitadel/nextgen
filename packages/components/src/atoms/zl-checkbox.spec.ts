import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-checkbox.js";
import type { ZlCheckbox } from "./zl-checkbox.js";

/**
 * jsdom-friendly markup/aria behaviour for `<zl-checkbox>`. Form-associated
 * semantics (`setFormValue`, `setValidity`, reset, focus delegation) live in
 * `zl-checkbox.browser.spec.ts` and run in real Chromium — jsdom 29 only ships
 * a partial `ElementInternals`.
 */
describe("<zl-checkbox> markup", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(html: string): ZlCheckbox {
    host.innerHTML = html;
    return host.querySelector("zl-checkbox") as ZlCheckbox;
  }

  it("renders the visible label text", async () => {
    const checkbox = mount(`<zl-checkbox name="terms" label="Accept terms"></zl-checkbox>`);
    await checkbox.updateComplete;
    const label = checkbox.shadowRoot?.querySelector(".zr-checkbox__label");
    expect(label?.textContent).toBe("Accept terms");
  });

  it("falls back to aria-label on the native input when no visible label", async () => {
    const checkbox = mount(`<zl-checkbox name="terms" aria-label="Accept terms"></zl-checkbox>`);
    await checkbox.updateComplete;
    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe("Accept terms");
  });

  it("does not set aria-label when a visible label is present", async () => {
    const checkbox = mount(
      `<zl-checkbox name="terms" label="Accept" aria-label="Accept"></zl-checkbox>`,
    );
    await checkbox.updateComplete;
    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBeNull();
  });

  it("derives a stable native input test id from the name", async () => {
    const checkbox = mount(`<zl-checkbox name="newsletter"></zl-checkbox>`);
    await checkbox.updateComplete;
    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("data-testid")).toBe("zitadel-checkbox-newsletter");
  });

  it("reflects checked and disabled to host attributes", async () => {
    const checkbox = mount(`<zl-checkbox name="terms" checked disabled></zl-checkbox>`);
    await checkbox.updateComplete;
    expect(checkbox.hasAttribute("checked")).toBe(true);
    expect(checkbox.hasAttribute("disabled")).toBe(true);
    expect(checkbox.shadowRoot?.querySelector(".zr-checkbox--disabled")).not.toBeNull();
  });

  it("projects the preview data-state onto the inner root", async () => {
    const checkbox = mount(`<zl-checkbox name="terms" data-state="hovered"></zl-checkbox>`);
    await checkbox.updateComplete;
    const root = checkbox.shadowRoot?.querySelector(".zr-checkbox");
    expect(root?.getAttribute("data-state")).toBe("hovered");
  });

  it("exposes formValue as the value token only when checked", async () => {
    const checkbox = mount(`<zl-checkbox name="opt" value="true"></zl-checkbox>`);
    await checkbox.updateComplete;
    expect(checkbox.formValue).toBe("");
    checkbox.checked = true;
    expect(checkbox.formValue).toBe("true");
  });

  it("restores the checked state when formValue is assigned", async () => {
    const checkbox = mount(`<zl-checkbox name="opt" value="true"></zl-checkbox>`);
    await checkbox.updateComplete;
    checkbox.formValue = "true";
    expect(checkbox.checked).toBe(true);
    checkbox.formValue = "";
    expect(checkbox.checked).toBe(false);
  });

  it("shows an inline error, marks the control invalid, and wires aria-describedby", async () => {
    const checkbox = mount(
      `<zl-checkbox name="terms" label="Accept" error="You must accept the terms."></zl-checkbox>`,
    );
    await checkbox.updateComplete;
    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    const error = checkbox.shadowRoot?.querySelector(".zr-checkbox__error");
    expect(error?.hasAttribute("hidden")).toBe(false);
    expect(error?.textContent?.trim()).toBe("You must accept the terms.");
    expect(checkbox.shadowRoot?.querySelector(".zr-checkbox--invalid")).not.toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error?.id);
  });

  it("hides the error node and stays valid without an error", async () => {
    const checkbox = mount(`<zl-checkbox name="terms" label="Accept"></zl-checkbox>`);
    await checkbox.updateComplete;
    const input = checkbox.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(checkbox.shadowRoot?.querySelector(".zr-checkbox__error")?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
});
