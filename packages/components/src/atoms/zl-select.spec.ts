import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-select.js";
import type { ZlSelect, ZlSelectOption } from "./zl-select.js";

/**
 * jsdom-friendly markup/aria behaviour for `<zl-select>`. The form-association
 * and keyboard contract (setFormValue / setValidity / arrow navigation / focus
 * delegation) lives in `zl-select.browser.spec.ts` and runs in real Chromium —
 * jsdom 29 only ships a partial `ElementInternals`.
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

  function trigger(el: ZlSelect): HTMLButtonElement {
    return el.shadowRoot?.querySelector(".zr-select__trigger") as HTMLButtonElement;
  }

  it("renders the visible label and wires it to the trigger", async () => {
    const el = await mount({ name: "country", label: "Country" });
    const label = el.shadowRoot?.querySelector(".zr-select__label span");
    expect(label?.textContent).toBe("Country");
    expect(trigger(el).getAttribute("aria-labelledby")).toContain("-label");
  });

  it("exposes a combobox trigger that is collapsed by default", async () => {
    const el = await mount({ name: "country" });
    const button = trigger(el);
    expect(button.getAttribute("role")).toBe("combobox");
    expect(button.getAttribute("aria-haspopup")).toBe("listbox");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(el.shadowRoot?.querySelector(".zr-select__listbox")?.hasAttribute("hidden")).toBe(true);
  });

  it("shows the placeholder until a value is selected", async () => {
    const el = await mount({ name: "country", placeholder: "Pick one" });
    const value = el.shadowRoot?.querySelector(".zr-select__value");
    expect(value?.textContent?.trim()).toBe("Pick one");
    expect(value?.classList.contains("zr-select__value--placeholder")).toBe(true);
  });

  it("shows the selected option label and drops the placeholder class", async () => {
    const el = await mount({ name: "country", value: "de" });
    const value = el.shadowRoot?.querySelector(".zr-select__value");
    expect(value?.textContent?.trim()).toBe("Germany");
    expect(value?.classList.contains("zr-select__value--placeholder")).toBe(false);
  });

  it("renders one option per item with selection and disabled state", async () => {
    const el = await mount({ name: "country", value: "us" });
    const options = el.shadowRoot?.querySelectorAll('[role="option"]');
    expect(options?.length).toBe(3);
    expect(options?.[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options?.[1]?.getAttribute("aria-selected")).toBe("false");
    expect(options?.[2]?.getAttribute("aria-disabled")).toBe("true");
  });

  it("derives a stable trigger test id from the name", async () => {
    const el = await mount({ name: "country" });
    expect(trigger(el).getAttribute("data-testid")).toBe("zitadel-select-country");
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
});
