import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./zl-button.js";
import type { ZlButton } from "./zl-button.js";

/**
 * `<zl-button>` with the shipped build's closed shadow root. It activates on a
 * click that lands on the host itself, and the inner button's own click also
 * reaches the host listener: with a closed root `composedPath()` hides the
 * inner button there, so a click must still activate exactly once.
 */
describe("<zl-button> activation (closed shadow root)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(type: string): Promise<{ button: ZlButton; submits: () => number }> {
    host.innerHTML = `<form><zl-button type="${type}" action="go" label="Go"></zl-button></form>`;
    const button = host.querySelector("zl-button");
    if (!button) throw new Error("zl-button did not render");
    let count = 0;
    button.addEventListener("zl-submit", () => {
      count += 1;
    });
    host.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      count += 1;
    });
    await button.updateComplete;
    return { button, submits: () => count };
  }

  it("has no reachable shadow root", async () => {
    const { button } = await mount("button");
    expect(button.shadowRoot).toBeNull();
  });

  it("emits zl-submit once for a pointer click on the control", async () => {
    const { button, submits } = await mount("button");
    await userEvent.click(button);
    expect(submits()).toBe(1);
  });

  it("emits zl-submit once for a click dispatched on the host", async () => {
    const { button, submits } = await mount("button");
    button.click();
    expect(submits()).toBe(1);
  });

  it("submits the owning form once for a pointer click on a submit button", async () => {
    const { button, submits } = await mount("submit");
    await userEvent.click(button);
    expect(submits()).toBe(1);
  });

  it("activates once on Enter after the host is focused", async () => {
    const { button, submits } = await mount("button");
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    expect(submits()).toBe(1);
  });
});
