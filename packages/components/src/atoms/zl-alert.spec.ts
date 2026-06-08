import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-alert.js";
import type { ZlAlert } from "./zl-alert.js";

/**
 * Markup + behaviour contract for `<zl-alert>`: severity drives the icon and
 * the live-region semantics, and the dismiss control fires `zl-dismiss` and
 * removes the host. Locks the surface before the Tier A refactor.
 */
describe("<zl-alert>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(markup: string): ZlAlert {
    host.innerHTML = markup;
    return host.querySelector("zl-alert") as ZlAlert;
  }

  it("uses an assertive alert role for errors", async () => {
    const el = mount(`<zl-alert severity="error">Boom</zl-alert>`);
    await el.updateComplete;
    const region = el.shadowRoot?.querySelector(".zr-alert");
    expect(region?.getAttribute("role")).toBe("alert");
    expect(region?.getAttribute("aria-live")).toBe("assertive");
  });

  it("uses a polite status role for non-error severities", async () => {
    const el = mount(`<zl-alert severity="success">Saved</zl-alert>`);
    await el.updateComplete;
    const region = el.shadowRoot?.querySelector(".zr-alert");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });

  it.each([
    ["error", "alert-circle"],
    ["warning", "alert-circle"],
    ["success", "check"],
    ["info", "info"],
  ] as const)("renders the %s severity icon (%s)", async (severity, icon) => {
    const el = mount(`<zl-alert severity="${severity}">msg</zl-alert>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("zl-icon")?.getAttribute("name")).toBe(icon);
  });

  it("renders an optional heading", async () => {
    const el = mount(`<zl-alert severity="info" heading="Heads up">Body</zl-alert>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".zr-alert__title")?.textContent).toBe("Heads up");
  });

  it("does not render a close button unless dismissible", async () => {
    const el = mount(`<zl-alert severity="info">msg</zl-alert>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".zr-alert__close")).toBeNull();
  });

  it("fires zl-dismiss and removes itself when dismissed", async () => {
    const el = mount(`<zl-alert severity="info" dismissible>msg</zl-alert>`);
    await el.updateComplete;
    let dismissed = 0;
    el.addEventListener("zl-dismiss", () => {
      dismissed += 1;
    });
    el.shadowRoot?.querySelector<HTMLButtonElement>(".zr-alert__close")?.click();
    expect(dismissed).toBe(1);
    expect(el.isConnected).toBe(false);
  });
});
