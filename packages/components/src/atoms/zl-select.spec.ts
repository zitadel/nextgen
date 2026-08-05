import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-select.js";
import type { ZlSelect, ZlSelectChangeDetail, ZlSelectOption } from "./zl-select.js";

/**
 * jsdom-friendly markup/aria behaviour for `<zl-select>`. The form-association
 * contract (setFormValue / setValidity / focus delegation) lives in
 * `zl-select.browser.spec.ts` and runs in real Chromium — jsdom 29 only ships a
 * partial `ElementInternals`.
 *
 * The agent-first control is a real native `<select>` (`.zr-select__native`);
 * the styled trigger + popup are an `aria-hidden` pointer-only visual layer
 * whose option state lives on `data-*` hooks, not ARIA.
 */
const OPTIONS: ZlSelectOption[] = [
  { value: "us", label: "United States" },
  { value: "de", label: "Germany" },
  { value: "ch", label: "Switzerland", disabled: true },
];

describe("<zl-select> markup", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(
    props: Partial<Pick<ZlSelect, "name" | "label" | "value" | "placeholder" | "options">> = {},
  ): Promise<ZlSelect> {
    const el = document.createElement("zl-select");
    if (props.name) el.name = props.name;
    if (props.label) el.label = props.label;
    if (props.value) el.value = props.value;
    if (props.placeholder) el.placeholder = props.placeholder;
    el.options = props.options ?? OPTIONS;
    host.appendChild(el);
    await el.updateComplete;
    return el;
  }

  function native(el: ZlSelect): HTMLSelectElement {
    return el.shadowRoot?.querySelector(".zr-select__native") as HTMLSelectElement;
  }

  function trigger(el: ZlSelect): HTMLDivElement {
    return el.shadowRoot?.querySelector(".zr-select__trigger") as HTMLDivElement;
  }

  it("renders the visible label and wires it to the native control", async () => {
    const el = await mount({ name: "country", label: "Country" });
    const label = el.shadowRoot?.querySelector(".zr-select__label span");
    expect(label?.textContent).toBe("Country");
    expect(native(el).getAttribute("aria-labelledby")).toContain("-label");
  });

  it("uses a real native <select> as the operable control, collapsed by default", async () => {
    const el = await mount({ name: "country" });
    expect(native(el).tagName).toBe("SELECT");
    // The styled popup is a pointer-only visual layer, hidden from AT.
    const listbox = el.shadowRoot?.querySelector(".zr-select__listbox");
    expect(listbox?.getAttribute("aria-hidden")).toBe("true");
    expect(listbox?.hasAttribute("hidden")).toBe(true);
    expect(trigger(el).getAttribute("aria-hidden")).toBe("true");
  });

  it("derives a stable native-control test id from the name", async () => {
    const el = await mount({ name: "country" });
    expect(native(el).getAttribute("data-testid")).toBe("zitadel-select-country");
  });

  it("renders a native option per item plus a leading empty option", async () => {
    const el = await mount({ name: "country", placeholder: "Pick one" });
    const options = native(el).querySelectorAll("option");
    expect(options.length).toBe(4);
    expect(options[0]?.value).toBe("");
    expect(options[0]?.textContent?.trim()).toBe("Pick one");
    expect(options[3]?.disabled).toBe(true);
  });

  it("keeps a single leading empty option when the enum itself lists an empty member", async () => {
    // A schema enum may explicitly list "" as an allowed value; the leading
    // placeholder row must not produce a second, duplicate empty option.
    const el = await mount({
      name: "country",
      placeholder: "Pick one",
      options: [{ value: "", label: "Unspecified" }, ...OPTIONS],
    });
    const options = native(el).querySelectorAll("option");
    const empties = [...options].filter((o) => o.value === "");
    expect(empties.length).toBe(1);
    expect(empties[0]?.textContent?.trim()).toBe("Pick one");
  });

  it("reflects the chosen value onto the native control", async () => {
    const el = await mount({ name: "country", value: "de" });
    expect(native(el).value).toBe("de");
  });

  it("shows the placeholder in the trigger until a value is selected", async () => {
    const el = await mount({ name: "country", placeholder: "Pick one" });
    const value = el.shadowRoot?.querySelector(".zr-select__value");
    expect(value?.textContent?.trim()).toBe("Pick one");
    expect(value?.classList.contains("zr-select__value--placeholder")).toBe(true);
  });

  it("shows the selected option label in the trigger and drops the placeholder class", async () => {
    const el = await mount({ name: "country", value: "de" });
    const value = el.shadowRoot?.querySelector(".zr-select__value");
    expect(value?.textContent?.trim()).toBe("Germany");
    expect(value?.classList.contains("zr-select__value--placeholder")).toBe(false);
  });

  it("paints the styled popup rows with leading empty row, selection, and disabled state", async () => {
    const el = await mount({ name: "country", value: "us", placeholder: "Pick one" });
    const rows = el.shadowRoot?.querySelectorAll(".zr-select__option");
    expect(rows?.length).toBe(4);
    expect(rows?.[0]?.getAttribute("data-value")).toBe("");
    expect(rows?.[0]?.textContent?.trim()).toBe("Pick one");
    expect(rows?.[0]?.hasAttribute("data-selected")).toBe(false);
    expect(rows?.[1]?.hasAttribute("data-selected")).toBe(true);
    expect(rows?.[3]?.hasAttribute("data-disabled")).toBe(true);
  });

  it("commits a pointer choice from the styled popup and emits zl-change", async () => {
    const el = await mount({ name: "country" });
    el.open = true;
    await el.updateComplete;
    const changes: ZlSelectChangeDetail[] = [];
    el.addEventListener("zl-change", (event) => {
      changes.push((event as CustomEvent<ZlSelectChangeDetail>).detail);
    });
    const germany = el.shadowRoot?.querySelectorAll<HTMLLIElement>(".zr-select__option")[2];
    germany?.click();
    await el.updateComplete;
    expect(el.value).toBe("de");
    expect(el.open).toBe(false);
    expect(changes).toEqual([{ name: "country", value: "de" }]);
  });

  it("commits a native-control change (native popup / automation) and emits zl-change", async () => {
    const el = await mount({ name: "country" });
    const changes: ZlSelectChangeDetail[] = [];
    el.addEventListener("zl-change", (event) => {
      changes.push((event as CustomEvent<ZlSelectChangeDetail>).detail);
    });
    const select = native(el);
    select.value = "us";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
    expect(el.value).toBe("us");
    expect(changes).toEqual([{ name: "country", value: "us" }]);
  });

  it("lets the user clear back to the empty option", async () => {
    const el = await mount({ name: "country", value: "us" });
    el.value = "";
    await el.updateComplete;
    expect(native(el).value).toBe("");
    const value = el.shadowRoot?.querySelector(".zr-select__value");
    expect(value?.classList.contains("zr-select__value--placeholder")).toBe(true);
  });

  it("exposes and restores the chosen value through formValue", async () => {
    const el = await mount({ name: "country", value: "de" });
    expect(el.formValue).toBe("de");
    el.formValue = "us";
    expect(el.value).toBe("us");
    el.formValue = "";
    expect(el.value).toBe("");
  });

  it("toggles the styled popup open from the visual trigger", async () => {
    const el = await mount({ name: "country" });
    expect(el.open).toBe(false);
    trigger(el).click();
    await el.updateComplete;
    expect(el.open).toBe(true);
  });

  it("closes the open styled popup on Escape", async () => {
    const el = await mount({ name: "country" });
    el.open = true;
    await el.updateComplete;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await el.updateComplete;
    expect(el.open).toBe(false);
  });

  it("reflects disabled and open to host attributes", async () => {
    const el = await mount({ name: "country" });
    el.disabled = true;
    el.open = true;
    await el.updateComplete;
    expect(el.hasAttribute("disabled")).toBe(true);
    // willUpdate forces a disabled select closed.
    expect(el.open).toBe(false);
  });

  it("shows an inline error, marks the control invalid, and wires aria-describedby", async () => {
    const el = await mount({ name: "country" });
    let error = el.shadowRoot?.querySelector(".zr-select__error");
    // No error → the message node is hidden and the control is valid.
    expect(error?.hasAttribute("hidden")).toBe(true);
    expect(native(el).getAttribute("aria-invalid")).toBe("false");

    el.error = "Country is required.";
    await el.updateComplete;
    error = el.shadowRoot?.querySelector(".zr-select__error");
    expect(error?.hasAttribute("hidden")).toBe(false);
    expect(error?.textContent?.trim()).toBe("Country is required.");
    expect(el.shadowRoot?.querySelector(".zr-select")?.classList.contains("zr-select--invalid")).toBe(
      true,
    );
    expect(native(el).getAttribute("aria-invalid")).toBe("true");
    expect(native(el).getAttribute("aria-describedby")).toBe(error?.id);
  });
});
