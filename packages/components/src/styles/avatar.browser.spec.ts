import { tokensCss } from "@zitadel/design-tokens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { avatarVars } from "../avatar.js";
import avatarCss from "./avatar.css?inline";

/**
 * The shared avatar rules as the console loads them, on the document, where
 * `@property` registers the moving angles. In a real browser because jsdom
 * runs no animations.
 */
describe("avatar.css (chromium)", () => {
  let host: HTMLDivElement;
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = tokensCss + avatarCss;
    document.head.appendChild(style);
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    style.remove();
  });

  function paint(className: string): CSSStyleDeclaration {
    const avatar = document.createElement("span");
    avatar.className = className;
    Object.assign(avatar.style, { width: "24px", height: "24px", display: "block" });
    for (const [name, value] of Object.entries(avatarVars("maya@example.com"))) {
      avatar.style.setProperty(name, value);
    }
    host.appendChild(avatar);
    return getComputedStyle(avatar);
  }

  it("holds still by default", () => {
    expect(paint("zl-avatar").animationName).toBe("none");
  });

  it("moves with zl-avatar-moving", () => {
    expect(paint("zl-avatar zl-avatar-moving").animationName).toBe(
      "zl-avatar-turn, zl-avatar-sway-a, zl-avatar-sway-b",
    );
  });
});
