import { tokensCss } from "@zitadel/design-tokens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-avatar.js";
import type { ZlAvatar } from "./zl-avatar.js";

/**
 * Computed paint, in a real browser because jsdom resolves neither `var()`
 * nor animations. Tokens are injected because the browser project loads no
 * stylesheet, and the gradient's colours come from them.
 */
describe("<zl-avatar> paint (chromium)", () => {
  let host: HTMLDivElement;
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = tokensCss;
    document.head.appendChild(style);
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    style.remove();
  });

  async function mount(markup: string): Promise<CSSStyleDeclaration> {
    host.innerHTML = markup;
    const element = host.querySelector("zl-avatar") as ZlAvatar;
    await element.updateComplete;
    const avatar = element.shadowRoot?.querySelector(".zl-avatar") as HTMLElement;
    return getComputedStyle(avatar);
  }

  it("holds still, so a remount on the next step does not jump", async () => {
    const avatar = await mount(`<zl-avatar seed="maya@example.com"></zl-avatar>`);
    expect(avatar.animationName).toBe("none");
  });

  it("paints its gradient at the seed's own angle, with the moving angles unregistered", async () => {
    const avatar = await mount(`<zl-avatar seed="maya@example.com"></zl-avatar>`);
    expect(avatar.backgroundImage).toMatch(/^linear-gradient\(324deg, /);
  });
});
