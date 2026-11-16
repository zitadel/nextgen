import { describe, expect } from "vitest";

import "./zl-alert.js";
import type { ZlAlert } from "./zl-alert.js";
import { it } from "../test/fixtures.js";

/**
 * Markup + behaviour contract for `<zl-alert>`: severity drives the icon and
 * the live-region semantics, and the dismiss control fires `zl-dismiss` and
 * removes the host. Locks the surface before the Tier A refactor.
 */
describe("<zl-alert>", () => {
  it("uses an assertive alert role for errors", async ({ render }) => {
    const el = await render<ZlAlert>(`<zl-alert severity="error">Boom</zl-alert>`);
    await el.updateComplete;
    const region = el.shadowRoot?.querySelector(".zr-alert");
    expect(region?.getAttribute("role")).toBe("alert");
    expect(region?.getAttribute("aria-live")).toBe("assertive");
  });

  it("uses a polite status role for non-error severities", async ({ render }) => {
    const el = await render<ZlAlert>(`<zl-alert severity="success">Saved</zl-alert>`);
    await el.updateComplete;
    const region = el.shadowRoot?.querySelector(".zr-alert");
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });

  it.for([
    ["error", "alert-circle"],
    ["warning", "alert-circle"],
    ["success", "check"],
    ["info", "info"],
  ] as const)("renders the %s severity icon (%s)", async ([severity, icon], { render }) => {
    const el = await render<ZlAlert>(`<zl-alert severity="${severity}">msg</zl-alert>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("zl-icon")?.getAttribute("name")).toBe(icon);
  });

  it("renders an optional heading", async ({ render }) => {
    const el = await render<ZlAlert>(
      `<zl-alert severity="info" heading="Heads up">Body</zl-alert>`,
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".zr-alert__title")?.textContent).toBe("Heads up");
  });

  it("projects the detail and link slots under the message", async ({ render }) => {
    const el = await render<ZlAlert>(
      `<zl-alert severity="error">Boom<span slot="detail">Why</span><a slot="link" href="#">More</a></zl-alert>`,
    );
    await el.updateComplete;
    const detail = el.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="detail"]');
    const link = el.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="link"]');
    expect(detail?.getAttribute("part")).toBe("detail");
    expect(link?.getAttribute("part")).toBe("link");
    expect(detail?.closest(".zr-alert__body")).toBeTruthy();
  });

  it("does not render a close button unless dismissible", async ({ render }) => {
    const el = await render<ZlAlert>(`<zl-alert severity="info">msg</zl-alert>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".zr-alert__close")).toBeNull();
  });

  it("fires zl-dismiss and removes itself when dismissed", async ({ render }) => {
    const el = await render<ZlAlert>(`<zl-alert severity="info" dismissible>msg</zl-alert>`);
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
