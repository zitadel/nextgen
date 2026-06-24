import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-select.js";
import type { ZlSelect, ZlSelectChangeDetail, ZlSelectOption } from "./zl-select.js";

/**
 * Real-browser checks for the form-participation and keyboard contract. These
 * rely on the full Form-Associated Custom Element API (setFormValue /
 * setValidity / formResetCallback / delegatesFocus) and real key events, which
 * jsdom 29 only partially implements. Run via `pnpm test:browser`.
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

  function trigger(select: ZlSelect): HTMLButtonElement {
    return select.shadowRoot?.querySelector(".zr-select__trigger") as HTMLButtonElement;
  }

  function press(select: ZlSelect, key: string): void {
    trigger(select).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
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

  it("opens with arrow keys and selects the active option on Enter", async () => {
    const { form, select } = await mount();
    let detail: ZlSelectChangeDetail | undefined;
    let nativeChanges = 0;
    select.addEventListener("zl-change", (event) => {
      detail = (event as CustomEvent<ZlSelectChangeDetail>).detail;
    });
    select.addEventListener("change", () => {
      nativeChanges += 1;
    });

    trigger(select).focus();
    press(select, "ArrowDown"); // open, active = empty prompt (value "")
    await select.updateComplete;
    expect(select.open).toBe(true);

    press(select, "ArrowDown"); // empty -> us
    await select.updateComplete;
    press(select, "Enter");
    await select.updateComplete;

    expect(select.value).toBe("us");
    expect(select.open).toBe(false);
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

    trigger(select).focus();
    press(select, "ArrowDown"); // open, active = us (selected)
    await select.updateComplete;
    press(select, "ArrowUp"); // us -> empty prompt
    await select.updateComplete;
    press(select, "Enter");
    await select.updateComplete;

    expect(select.value).toBe("");
    expect(new FormData(form).get("country")).toBeNull();
    expect(detail).toEqual({ name: "country", value: "" });
  });

  it("skips disabled options during keyboard navigation", async () => {
    const { select } = await mount("", "de");
    trigger(select).focus();
    press(select, "ArrowDown"); // open, active = de (selected)
    await select.updateComplete;
    press(select, "ArrowDown"); // de -> skip ch (disabled) -> at
    await select.updateComplete;
    press(select, "Enter");
    await select.updateComplete;
    expect(select.value).toBe("at");
  });

  it("closes on Escape without changing the value", async () => {
    const { select } = await mount("", "us");
    trigger(select).focus();
    press(select, "ArrowDown");
    await select.updateComplete;
    press(select, "ArrowDown");
    await select.updateComplete;
    press(select, "Escape");
    await select.updateComplete;
    expect(select.open).toBe(false);
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

  it("delegates focus from the host to the trigger", async () => {
    const { select } = await mount();
    select.focus();
    expect(select.shadowRoot?.activeElement).toBe(trigger(select));
  });
});
