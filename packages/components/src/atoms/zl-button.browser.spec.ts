import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-button.js";
import type { ZlButton } from "./zl-button.js";

/**
 * Real-browser form participation for `<zl-button>`. The button is a
 * form-associated custom element: `type="submit"` drives
 * `form.requestSubmit()` and `type="reset"` drives `form.reset()` through the
 * shadow boundary, and `delegatesFocus` lands Tab on the inner `<button>`.
 * jsdom 29 only partially implements `ElementInternals`, so these run in real
 * Chromium via `pnpm test:browser`.
 */
describe("<zl-button> form participation (chromium)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("submits the owning form when type=submit is clicked", async () => {
    host.innerHTML = `<form><zl-button type="submit" action="go" label="Go"></zl-button></form>`;
    const form = host.querySelector("form") as HTMLFormElement;
    const button = host.querySelector("zl-button") as ZlButton;
    await button.updateComplete;
    let submitted = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });
    button.shadowRoot?.querySelector("button")?.click();
    expect(submitted).toBe(1);
  });

  it("resets the owning form when type=reset is clicked", async () => {
    host.innerHTML = `<form><input name="x" value="seed" /><zl-button type="reset" label="Reset"></zl-button></form>`;
    const input = host.querySelector("input") as HTMLInputElement;
    const button = host.querySelector("zl-button") as ZlButton;
    await button.updateComplete;
    input.value = "changed";
    button.shadowRoot?.querySelector("button")?.click();
    expect(input.value).toBe("seed");
  });

  it("delegates focus from the host to the inner button", async () => {
    host.innerHTML = `<zl-button label="Focus me"></zl-button>`;
    const button = host.querySelector("zl-button") as ZlButton;
    await button.updateComplete;
    button.focus();
    const inner = button.shadowRoot?.querySelector("button");
    expect(button.shadowRoot?.activeElement).toBe(inner);
  });
});
