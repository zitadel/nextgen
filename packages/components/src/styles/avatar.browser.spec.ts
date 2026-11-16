import { beforeEach, describe, expect, it, onTestFinished } from "vitest";

import avatarCss from "./avatar.css?inline";

/** The shared avatar rules, in a real browser because jsdom runs no animations. */
describe("avatar.css (chromium)", () => {
  let style: HTMLStyleElement;
  let avatar: HTMLSpanElement;

  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = avatarCss;
    document.head.appendChild(style);
    avatar = document.body.appendChild(document.createElement("span"));
    onTestFinished(() => {
      avatar.remove();
      style.remove();
    });
  });

  it("holds still by default", () => {
    avatar.className = "zl-avatar";
    expect(getComputedStyle(avatar).animationName).toBe("none");
  });

  it("moves with zl-avatar-moving", () => {
    avatar.className = "zl-avatar zl-avatar-moving";
    expect(getComputedStyle(avatar).animationName).toBe(
      "zl-avatar-turn, zl-avatar-sway-a, zl-avatar-sway-b",
    );
  });
});
