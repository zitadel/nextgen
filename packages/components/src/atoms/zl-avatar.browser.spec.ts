import { tokensCss } from "@zitadel/design-tokens";
import { describe, expect } from "vitest";

import "./zl-avatar.js";
import type { ZlAvatar } from "./zl-avatar.js";
import { test } from "../test/fixtures.js";

/**
 * `it` with the design tokens injected into the document head for every test
 * and removed when it ends.
 */
const it = test.extend<{ tokens: undefined }>({
  tokens: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      const style = document.createElement("style");
      style.textContent = tokensCss;
      document.head.appendChild(style);
      await use(undefined);
      style.remove();
    },
    { auto: true },
  ],
});

/**
 * Computed paint, in a real browser because jsdom resolves no `var()`. Tokens
 * are injected because the browser project loads no stylesheet, and the
 * gradient's colours come from them. Nothing registers the moving angles here,
 * as on a page that never loads `avatar.css`.
 */
describe("<zl-avatar> paint (chromium)", () => {
  it("paints its gradient at the seed's own angle, with the moving angles unregistered", async ({
    render,
  }) => {
    const element = await render<ZlAvatar>(`<zl-avatar seed="maya@example.com"></zl-avatar>`);
    const avatar = element.shadowRoot?.querySelector(".zl-avatar") as HTMLElement;
    expect(getComputedStyle(avatar).backgroundImage).toMatch(/^linear-gradient\(324deg, /);
  });
});
