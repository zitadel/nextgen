import { tokensCss } from "@zitadel/design-tokens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-alert.js";
import type { ZlAlert } from "./zl-alert.js";

/**
 * Icon geometry, in a real browser because jsdom has no layout. Tokens are
 * injected because the browser project loads no stylesheet, and without them
 * `line-height` falls back to a value the product never renders.
 */
describe("<zl-alert> icon geometry (chromium)", () => {
  let host: HTMLDivElement;
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = tokensCss;
    document.head.appendChild(style);
    host = document.createElement("div");
    host.style.width = "320px"; // narrow enough to wrap the long message
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    style.remove();
  });

  async function mount(markup: string): Promise<ZlAlert> {
    host.innerHTML = markup;
    const alert = host.querySelector("zl-alert") as ZlAlert;
    await alert.updateComplete;
    // The inner <zl-icon> renders into its own shadow root a frame later.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return alert;
  }

  /** The painted glyph box; the `display: contents` host has none. */
  function glyphBox(alert: ZlAlert): DOMRect {
    const iconHost = alert.shadowRoot?.querySelector("zl-icon.zr-alert__icon") as HTMLElement;
    const glyph = iconHost.shadowRoot?.querySelector(".zr-icon") as HTMLElement;
    return glyph.getBoundingClientRect();
  }

  const LONG =
    "The request is invalid and fails base validation (missing required fields, wrong types, failed regex, etc.). Check the details for more information.";

  it("keeps the glyph at 16px however long the message is", async () => {
    for (const message of ["flow not found", LONG]) {
      const box = glyphBox(await mount(`<zl-alert severity="error">${message}</zl-alert>`));
      expect({ w: box.width, h: box.height }).toEqual({ w: 16, h: 16 });
    }
  });

  it("centres the glyph on the first line of text, wrapped or not", async () => {
    const centreY = (r: DOMRect) => (r.top + r.bottom) / 2;
    for (const message of ["flow not found", LONG]) {
      const alert = await mount(`<zl-alert severity="error">${message}</zl-alert>`);
      const text = alert.shadowRoot?.querySelector(".zr-alert__message") as HTMLElement;
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
      const firstLineCentre = text.getBoundingClientRect().top + lineHeight / 2;
      expect(Math.abs(centreY(glyphBox(alert)) - firstLineCentre)).toBeLessThanOrEqual(1);
    }
  });
});
