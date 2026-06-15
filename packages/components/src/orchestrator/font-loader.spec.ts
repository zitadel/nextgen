import { afterEach, describe, expect, it } from "vitest";

import { applyFontUrl } from "./font-loader.js";

const LINK_ID = "zl-font-link";
const FONT_A = "https://fonts.example/a.css";
const FONT_B = "https://fonts.example/b.css";

function makeShadowRoot(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

function links(): HTMLLinkElement[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>(`link#${LINK_ID}`)];
}

afterEach(() => {
  links().forEach((el) => el.remove());
  document.body.innerHTML = "";
});

describe("applyFontUrl", () => {
  it("injects the stylesheet link into document.head", () => {
    applyFontUrl(makeShadowRoot(), FONT_A);
    expect(links()).toHaveLength(1);
    expect(links()[0]?.rel).toBe("stylesheet");
    expect(links()[0]?.href).toBe(FONT_A);
  });

  it("reuses the same link element across calls", () => {
    const root = makeShadowRoot();
    applyFontUrl(root, FONT_A);
    const first = links()[0];
    applyFontUrl(root, FONT_A);
    applyFontUrl(root, FONT_B);
    expect(links()).toHaveLength(1);
    expect(links()[0]).toBe(first);
    expect(links()[0]?.href).toBe(FONT_B);
  });

  it("removes the link when called with null", () => {
    const root = makeShadowRoot();
    applyFontUrl(root, FONT_A);
    applyFontUrl(root, null);
    expect(links()).toHaveLength(0);
  });
});
