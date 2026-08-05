import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-field.js";
import type { ZlField } from "./zl-field.js";

/**
 * Real-browser checks for the form-participation contract documented in
 * `docs/design/branding/form-participation.md`. These rely on the full
 * Form-Associated Custom Element API (setFormValue / setValidity /
 * internals.form / formResetCallback), which jsdom 29 still partially
 * implements. Run via `pnpm test:browser` (Vitest browser mode + Playwright
 * Chromium).
 */
describe("<zl-field> form participation (chromium)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(html: string): { form: HTMLFormElement; field: ZlField } {
    host.innerHTML = html;
    const form = host.querySelector("form") as HTMLFormElement;
    const field = host.querySelector("zl-field") as ZlField;
    return { form, field };
  }

  it("contributes its value to the enclosing FormData", async () => {
    const { form, field } = mount(
      `<form><zl-field name="email" type="email"></zl-field></form>`,
    );
    await field.updateComplete;
    field.value = "alice@acme.com";
    await field.updateComplete;
    expect(new FormData(form).get("email")).toBe("alice@acme.com");
  });

  it("flags valueMissing when required and empty", async () => {
    const { form, field } = mount(
      `<form><zl-field name="email" required></zl-field></form>`,
    );
    await field.updateComplete;
    expect(form.checkValidity()).toBe(false);
    field.value = "alice@acme.com";
    await field.updateComplete;
    expect(form.checkValidity()).toBe(true);
  });

  it("forwards a custom error message via setValidity", async () => {
    const { form, field } = mount(
      `<form><zl-field name="email" value="x"></zl-field></form>`,
    );
    await field.updateComplete;
    field.error = "That email is already registered.";
    await field.updateComplete;
    expect(form.checkValidity()).toBe(false);
  });

  it("clears its value when the host form is reset", async () => {
    const { form, field } = mount(
      `<form><zl-field name="email" value="seed"></zl-field></form>`,
    );
    await field.updateComplete;
    field.value = "alice@acme.com";
    await field.updateComplete;
    form.reset();
    await field.updateComplete;
    expect(field.value).toBe("");
  });

  it("submits the owning form when Enter is pressed inside the input", async () => {
    const { form, field } = mount(
      `<form><zl-field name="email" value="alice@acme.com"></zl-field></form>`,
    );
    await field.updateComplete;
    let submitted = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
      }),
    );
    expect(submitted).toBe(1);
  });

  it("does not submit on Enter when modifier keys are held", async () => {
    const { form, field } = mount(
      `<form><zl-field name="email" value="alice@acme.com"></zl-field></form>`,
    );
    await field.updateComplete;
    let submitted = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        composed: true,
      }),
    );
    expect(submitted).toBe(0);
  });

  it("normalises the auth-method credential name in the input testid", async () => {
    const { field } = mount(
      `<form><zl-field name="x-auth-methods#password" type="password" data-testid="zitadel-field-password"></zl-field></form>`,
    );
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    // The hook is method-named; the form key stays raw.
    expect(input.getAttribute("data-testid")).toBe("zitadel-input-password");
    expect(input.getAttribute("name")).toBe("x-auth-methods#password");
  });

  it("delegates focus from the host to the inner input", async () => {
    const { field } = mount(`<form><zl-field name="email"></zl-field></form>`);
    await field.updateComplete;
    field.focus();
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(field.shadowRoot?.activeElement).toBe(input);
  });

  it("syncs native input/change events with host value and FormData", async () => {
    const { form, field } = mount(
      `<form><zl-field name="email" data-testid="zitadel-field-email"></zl-field></form>`,
    );
    await field.updateComplete;
    const input = field.shadowRoot?.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("data-testid")).toBe("zitadel-input-email");
    let inputEvents = 0;
    let changeEvents = 0;
    let hostInputEvent: Event | undefined;
    field.addEventListener("input", (event) => {
      inputEvents += 1;
      hostInputEvent = event;
    });
    field.addEventListener("change", () => {
      changeEvents += 1;
    });

    input.value = "alice@acme.com";
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: "m",
        inputType: "insertText",
      }),
    );
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    expect(field.value).toBe("alice@acme.com");
    expect(new FormData(form).get("email")).toBe("alice@acme.com");
    expect(inputEvents).toBe(1);
    expect(changeEvents).toBe(1);
    expect(hostInputEvent).toBeInstanceOf(InputEvent);
    expect((hostInputEvent as InputEvent).data).toBe("m");
    expect((hostInputEvent as InputEvent).inputType).toBe("insertText");
  });
});
