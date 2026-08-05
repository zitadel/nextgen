import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-select.js";
import type { ZlSelect, ZlSelectChangeDetail, ZlSelectOption } from "./zl-select.js";

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
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(
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

  it("contributes the selected value to FormData", async () => {
    const { form } = await mount("", "de");
    expect(new FormData(form).get("country")).toBe("de");
  });

  it("contributes nothing until a value is chosen", async () => {
    const { form } = await mount();
    expect(new FormData(form).get("country")).toBeNull();
  });

  it("flags valueMissing when required and empty", async () => {
    const { form, select } = await mount("required");
    expect(form.checkValidity()).toBe(false);
    select.value = "us";
    await select.updateComplete;
    expect(form.checkValidity()).toBe(true);
  });

  it("commits a native-control change to value, FormData, and listeners", async () => {
    const { form, select } = await mount();
    let detail: ZlSelectChangeDetail | undefined;
    let nativeChanges = 0;
    select.addEventListener("zl-change", (event) => {
      detail = (event as CustomEvent<ZlSelectChangeDetail>).detail;
    });
    select.addEventListener("change", () => {
      nativeChanges += 1;
    });

    await selectNative(select, "us");

    expect(select.value).toBe("us");
    expect(new FormData(form).get("country")).toBe("us");
    expect(detail).toEqual({ name: "country", value: "us" });
    expect(nativeChanges).toBe(1);
  });

  it("lets the user clear back to the empty option, contributing nothing to FormData", async () => {
    const { form, select } = await mount("", "us");
    let detail: ZlSelectChangeDetail | undefined;
    select.addEventListener("zl-change", (event) => {
      detail = (event as CustomEvent<ZlSelectChangeDetail>).detail;
    });

    await selectNative(select, "");

    expect(select.value).toBe("");
    expect(new FormData(form).get("country")).toBeNull();
    expect(detail).toEqual({ name: "country", value: "" });
  });

  it("mirrors the chosen value onto the native control for automation drivers", async () => {
    const { select } = await mount("", "de");
    expect(native(select).value).toBe("de");
    expect(native(select).getAttribute("data-testid")).toBe("zitadel-select-country");
  });

  it("commits a pointer choice from the styled popup", async () => {
    const { form, select } = await mount();
    select.open = true;
    await select.updateComplete;
    // Leading empty row + us, de, ch(disabled), at → "at" is index 4.
    options(select)[4]?.click();
    await select.updateComplete;
    expect(select.value).toBe("at");
    expect(select.open).toBe(false);
    expect(new FormData(form).get("country")).toBe("at");
  });

  it("ignores pointer clicks on a disabled popup row", async () => {
    const { select } = await mount("", "us");
    select.open = true;
    await select.updateComplete;
    // ch (disabled) is index 3.
    options(select)[3]?.click();
    await select.updateComplete;
    expect(select.value).toBe("us");
  });

  it("restores the default value when the host form is reset", async () => {
    const { form, select } = await mount('value="us"');
    select.value = "de";
    await select.updateComplete;
    form.reset();
    await select.updateComplete;
    expect(select.value).toBe("us");
  });

  it("delegates focus from the host to the native control", async () => {
    const { select } = await mount();
    select.focus();
    expect(select.shadowRoot?.activeElement).toBe(native(select));
  });
});
