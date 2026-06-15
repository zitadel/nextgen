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

// Query by tag then filter by id: jsdom's selector engine resolves `tag#id`
// via getElementById, which returns only the first element sharing the id and
// can miss our link when an unrelated element reuses the id.
function ownLinks(): HTMLLinkElement[] {
  return [...document.head.querySelectorAll("link")].filter((el) => el.id === LINK_ID);
}

function headLink(): HTMLLinkElement | null {
  return ownLinks()[0] ?? null;
}

afterEach(() => {
  document.head.querySelectorAll(`#${LINK_ID}`).forEach((el) => el.remove());
  document.body.innerHTML = "";
});

describe("applyFontUrl", () => {
  it("injects the stylesheet link into document.head", () => {
    applyFontUrl(makeShadowRoot(), FONT_A);
    const link = headLink();
    expect(link).not.toBeNull();
    expect(link?.rel).toBe("stylesheet");
    expect(link?.href).toBe(FONT_A);
  });

  it("is idempotent for the same URL (no duplicate links)", () => {
    const root = makeShadowRoot();
    applyFontUrl(root, FONT_A);
    applyFontUrl(root, FONT_A);
    expect(ownLinks()).toHaveLength(1);
  });

  it("replaces the link when the URL changes", () => {
    const root = makeShadowRoot();
    applyFontUrl(root, FONT_A);
    applyFontUrl(root, FONT_B);
    expect(ownLinks()).toHaveLength(1);
    expect(headLink()?.href).toBe(FONT_B);
  });

  it("removes the link when called with null", () => {
    const root = makeShadowRoot();
    applyFontUrl(root, FONT_A);
    applyFontUrl(root, null);
    expect(headLink()).toBeNull();
  });

  it("does not clobber an unrelated element that shares the id", () => {
    // A host page already uses the id on a non-link element.
    const stranger = document.createElement("meta");
    stranger.id = LINK_ID;
    document.head.appendChild(stranger);

    applyFontUrl(makeShadowRoot(), FONT_A);

    // The stranger survives, and our own link is added alongside it.
    expect(document.head.contains(stranger)).toBe(true);
    expect(ownLinks()).toHaveLength(1);
    expect(headLink()?.href).toBe(FONT_A);

    // Removal also leaves the unrelated element untouched.
    applyFontUrl(makeShadowRoot(), null);
    expect(document.head.contains(stranger)).toBe(true);
  });
});
