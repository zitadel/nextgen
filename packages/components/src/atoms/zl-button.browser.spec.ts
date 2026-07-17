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

  it("falls back to attributes when upgraded properties are empty", async () => {
    host.innerHTML = `<form><zl-button type="submit" action="go" label="Go"></zl-button></form>`;
    const form = host.querySelector("form") as HTMLFormElement;
    const button = host.querySelector("zl-button") as ZlButton;
    await button.updateComplete;

    button.type = "" as ZlButton["type"];
    button.action = "";
    await button.updateComplete;

    let submitted = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });

    const native = button.shadowRoot?.querySelector("button");
    expect(native?.getAttribute("data-testid")).toBe("zitadel-action-go");
    native?.click();

    expect(submitted).toBe(1);
  });

  it("submits when automation dispatches the click on the custom-element host", async () => {
    host.innerHTML = `<form><zl-button type="submit" action="go" label="Go"></zl-button></form>`;
    const form = host.querySelector("form") as HTMLFormElement;
    const button = host.querySelector("zl-button") as ZlButton;
    await button.updateComplete;

    let submitted = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });

    button.click();

    expect(submitted).toBe(1);
  });

  it("does not emit zl-submit when a submit-type button delegates to the form", async () => {
    // A submit button hands off to form.requestSubmit() so native constraint
    // validation runs; emitting zl-submit too would let the orchestrator
    // submit even when a required field is invalid. The form `submit` event is
    // the single submission signal for submit-type buttons.
    host.innerHTML = `<form><zl-button type="submit" action="go" label="Go"></zl-button></form>`;
    const form = host.querySelector("form") as HTMLFormElement;
    const button = host.querySelector("zl-button") as ZlButton;
    await button.updateComplete;

    let submitted = 0;
    let zlSubmits = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });
    button.addEventListener("zl-submit", () => {
      zlSubmits += 1;
    });

    button.shadowRoot?.querySelector("button")?.click();

    expect(submitted).toBe(1);
    expect(zlSubmits).toBe(0);
  });

  it("blocks submission when a required field is empty", async () => {
    // The whole point of delegating to the form: an invalid required control
    // must stop the submit (and no zl-submit escape hatch fires).
    host.innerHTML = `<form><input name="x" required /><zl-button type="submit" action="go" label="Go"></zl-button></form>`;
    const form = host.querySelector("form") as HTMLFormElement;
    const button = host.querySelector("zl-button") as ZlButton;
    await button.updateComplete;

    let submitted = 0;
    let zlSubmits = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted += 1;
    });
    button.addEventListener("zl-submit", () => {
      zlSubmits += 1;
    });

    button.shadowRoot?.querySelector("button")?.click();

    expect(submitted).toBe(0);
    expect(zlSubmits).toBe(0);
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
