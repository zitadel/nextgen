import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-button.js";
import type { ZlButton } from "./zl-button.js";

/**
 * jsdom-friendly rendering + event contract for `<zl-button>`. Form
 * participation (`internals.form`, submit/reset, focus delegation) needs a
 * real `ElementInternals` and lives in `zl-button.browser.spec.ts`.
 *
 * These lock the observable surface (classes, label/slot, spinner, aria-busy,
 * `zl-submit` detail) so the Tier A Lit refactor (classMap, reactive
 * `data-state`) can be proven DOM-preserving.
 */
describe("<zl-button> rendering (jsdom)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(markup: string): ZlButton {
    host.innerHTML = markup;
    return host.querySelector("zl-button") as ZlButton;
  }

  it("maps hierarchy/size/block to surface classes", async () => {
    const el = mount(`<zl-button hierarchy="secondary" size="small" block label="Go"></zl-button>`);
    await el.updateComplete;
    const button = el.shadowRoot?.querySelector("button");
    expect(button?.classList.contains("zr-btn--secondary")).toBe(true);
    expect(button?.classList.contains("zr-btn--small")).toBe(true);
    expect(button?.classList.contains("zr-btn--block")).toBe(true);
  });

  it("renders the label and reflects hierarchy/size to the host", async () => {
    const el = mount(`<zl-button hierarchy="primary" size="medium" label="Continue"></zl-button>`);
    await el.updateComplete;
    expect(el.shadowRoot?.textContent).toContain("Continue");
    expect(el.getAttribute("hierarchy")).toBe("primary");
    expect(el.getAttribute("size")).toBe("medium");
  });

  it("shows a spinner and sets aria-busy while loading", async () => {
    const el = mount(`<zl-button label="Save" loading></zl-button>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".spinner")).toBeTruthy();
    expect(el.shadowRoot?.querySelector("button")?.getAttribute("aria-busy")).toBe("true");
  });

  it("emits zl-submit carrying the action on click", async () => {
    const el = mount(`<zl-button label="Next" action="submit"></zl-button>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("button")?.getAttribute("data-testid")).toBe(
      "zitadel-action-submit",
    );
    let detail: unknown;
    el.addEventListener("zl-submit", (event) => {
      detail = (event as CustomEvent).detail;
    });
    el.shadowRoot?.querySelector("button")?.click();
    expect(detail).toEqual({ action: "submit" });
  });

  it("projects host test ids onto the native button", async () => {
    const el = mount(`<zl-button label="Next" action="submit" data-testid="zitadel-action-submit"></zl-button>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("button")?.getAttribute("data-testid")).toBe(
      "zitadel-action-submit-button",
    );
  });

  it("emits zl-submit with a null action when none is set", async () => {
    const el = mount(`<zl-button label="Next"></zl-button>`);
    await el.updateComplete;
    let detail: { action: string | null } | undefined;
    el.addEventListener("zl-submit", (event) => {
      detail = (event as CustomEvent).detail;
    });
    el.shadowRoot?.querySelector("button")?.click();
    expect(detail).toEqual({ action: null });
  });

  it("suppresses zl-submit while disabled", async () => {
    const el = mount(`<zl-button label="Next" action="go" disabled></zl-button>`);
    await el.updateComplete;
    let count = 0;
    el.addEventListener("zl-submit", () => {
      count += 1;
    });
    el.shadowRoot?.querySelector("button")?.click();
    expect(count).toBe(0);
  });
});
