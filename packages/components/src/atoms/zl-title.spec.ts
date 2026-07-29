import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zl-title.js";
import type { ZlTitle } from "./zl-title.js";

/**
 * Markup contract for `<zl-title>`: a plain `<h1>` without `back-action`,
 * and with it, a labelled back `<button>` that dispatches the standard
 * `zl-submit` CustomEvent carrying the action name (ADR 022).
 */
describe("<zl-title>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(markup: string): ZlTitle {
    host.innerHTML = markup;
    return host.querySelector("zl-title") as ZlTitle;
  }

  it("renders a plain heading without back-action", async () => {
    const el = mount(`<zl-title>Sign in</zl-title>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("h1")).toBeTruthy();
    expect(el.shadowRoot?.querySelector("button")).toBeNull();
  });

  it("renders a labelled back button when back-action is set", async () => {
    const el = mount(`<zl-title back-action="back" back-label="Back">Create password</zl-title>`);
    await el.updateComplete;
    const button = el.shadowRoot?.querySelector("button");
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-label")).toBe("Back");
    expect(button?.getAttribute("type")).toBe("button");
    // The heading itself stays non-interactive.
    expect(el.shadowRoot?.querySelector("h1 button")).toBeNull();
  });

  it("dispatches zl-submit with the action name on click", async () => {
    const el = mount(`<zl-title back-action="go-back" back-label="Back">Title</zl-title>`);
    await el.updateComplete;
    const seen = vi.fn();
    host.addEventListener("zl-submit", ((event: CustomEvent<{ action: string | null }>) => {
      seen(event.detail.action);
    }) as EventListener);

    el.shadowRoot?.querySelector("button")?.click();
    expect(seen).toHaveBeenCalledWith("go-back");
  });

  it("removes the button when back-action is cleared", async () => {
    const el = mount(`<zl-title back-action="back">Title</zl-title>`);
    await el.updateComplete;
    el.removeAttribute("back-action");
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("button")).toBeNull();
  });
});
