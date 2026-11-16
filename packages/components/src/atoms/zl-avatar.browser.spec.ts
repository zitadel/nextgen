import { tokensCss } from "@zitadel/design-tokens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-avatar.js";
import type { ZlAvatar } from "./zl-avatar.js";

/**
 * Computed paint, in a real browser because jsdom resolves no `var()`. Tokens
 * are injected because the browser project loads no stylesheet, and the
 * gradient's colours come from them. Nothing registers the moving angles here,
 * as on a page that never loads `avatar.css`.
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

  it("paints its gradient at the seed's own angle, with the moving angles unregistered", async () => {
    host.innerHTML = `<zl-avatar seed="maya@example.com"></zl-avatar>`;
    const element = host.querySelector("zl-avatar") as ZlAvatar;
    await element.updateComplete;
    const avatar = element.shadowRoot?.querySelector(".zl-avatar") as HTMLElement;
    expect(getComputedStyle(avatar).backgroundImage).toMatch(/^linear-gradient\(324deg, /);
  });
});
