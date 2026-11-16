import { describe, expect } from "vitest";

import "./zl-select.js";
import type { ZlSelect, ZlSelectOption } from "./zl-select.js";
import { it } from "../test/fixtures.js";

/**
 * Real-browser checks for the form-participation contract. These rely on the
 * full Form-Associated Custom Element API (setFormValue / setValidity /
 * formResetCallback / delegatesFocus), which jsdom 29 only partially
 * implements. Run via `pnpm test:browser`.
 *
 * Keyboard and assistive-tech selection flow through the real native `<select>`
 * (`.zr-select__native`): its native popup ultimately fires a `change` event,
 * which is exactly what automation drivers (Playwright `selectOption`, the
 * chrome-devtools a11y snapshot) trigger too. We exercise that `change` path
 * directly rather than driving the OS-level native popup.
 */
const OPTIONS: ZlSelectOption[] = [
  { value: "us", label: "United States" },
  { value: "de", label: "Germany" },
  { value: "ch", label: "Switzerland", disabled: true },
  { value: "at", label: "Austria" },
];

describe("<zl-select> form participation (chromium)", () => {
  async function mount(
    host: HTMLElement,
    attrs = "",
    value?: string,
  ): Promise<{ form: HTMLFormElement; select: ZlSelect }> {
    host.innerHTML = `<form><zl-select name="country" ${attrs}></zl-select></form>`;
    const select = host.querySelector("zl-select") as ZlSelect;
    select.options = OPTIONS;
    if (value) select.value = value;
    await select.updateComplete;
    return { form: host.querySelector("form") as HTMLFormElement, select };
  }

  function native(select: ZlSelect): HTMLSelectElement {
    return select.shadowRoot?.querySelector(".zr-select__native") as HTMLSelectElement;
  }

  function options(select: ZlSelect): HTMLLIElement[] {
    return [...(select.shadowRoot?.querySelectorAll<HTMLLIElement>(".zr-select__option") ?? [])];
  }

  /** Simulate a selection through the native control (native popup / automation). */
  async function selectNative(select: ZlSelect, value: string): Promise<void> {
    const el = native(select);
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await select.updateComplete;
  }

  it("contributes the selected value to FormData", async ({ host }) => {
    const { form } = await mount(host, "", "de");
    expect(new FormData(form).get("country")).toBe("de");
  });

  it("contributes nothing until a value is chosen", async ({ host }) => {
    const { form } = await mount(host);
    expect(new FormData(form).get("country")).toBeNull();
  });

  it("flags valueMissing when required and empty", async ({ host }) => {
    const { form, select } = await mount(host, "required");
    expect(form.checkValidity()).toBe(false);
    select.value = "us";
    await select.updateComplete;
    expect(form.checkValidity()).toBe(true);
  });

  it("contributes a native-control change to FormData and re-dispatches one change", async ({
    host,
  }) => {
    const { form, select } = await mount(host);
    let nativeChanges = 0;
    select.addEventListener("change", () => {
      nativeChanges += 1;
    });
    await selectNative(select, "us");
    expect(new FormData(form).get("country")).toBe("us");
    expect(nativeChanges).toBe(1);
  });

  it("contributes nothing to FormData once cleared back to the empty option", async ({ host }) => {
    const { form, select } = await mount(host, "", "us");
    await selectNative(select, "");
    expect(new FormData(form).get("country")).toBeNull();
  });

  it("contributes a pointer choice from the styled popup to FormData", async ({ host }) => {
    const { form, select } = await mount(host);
    select.open = true;
    await select.updateComplete;
    // Leading empty row + us, de, ch(disabled), at → "at" is index 4.
    options(select)[4]?.click();
    await select.updateComplete;
    expect(new FormData(form).get("country")).toBe("at");
  });

  it("ignores pointer clicks on a disabled popup row", async ({ host }) => {
    const { select } = await mount(host, "", "us");
    select.open = true;
    await select.updateComplete;
    // ch (disabled) is index 3.
    options(select)[3]?.click();
    await select.updateComplete;
    expect(select.value).toBe("us");
  });

  it("restores the default value when the host form is reset", async ({ host }) => {
    const { form, select } = await mount(host, 'value="us"');
    select.value = "de";
    await select.updateComplete;
    form.reset();
    await select.updateComplete;
    expect(select.value).toBe("us");
  });

  it("is disabled by an enclosing fieldset", async ({ host }) => {
    host.innerHTML = `<form><fieldset disabled><zl-select name="country" value="us"></zl-select></fieldset></form>`;
    const form = host.querySelector("form") as HTMLFormElement;
    const select = host.querySelector("zl-select") as ZlSelect;
    select.options = OPTIONS;
    await select.updateComplete;
    expect(native(select).disabled).toBe(true);
    expect(new FormData(form).get("country")).toBeNull();

    (form.querySelector("fieldset") as HTMLFieldSetElement).disabled = false;
    await select.updateComplete;
    expect(native(select).disabled).toBe(false);
    expect(new FormData(form).get("country")).toBe("us");
  });

  it("delegates focus from the host to the native control", async ({ host }) => {
    const { select } = await mount(host);
    select.focus();
    expect(select.shadowRoot?.activeElement).toBe(native(select));
  });
});
