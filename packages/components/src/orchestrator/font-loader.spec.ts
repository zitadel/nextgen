import { afterEach, describe, expect, it } from "vitest";

import { applyFontUrl } from "./font-loader.js";

const TENANT_LINK_ID = "zl-font-link";
const FONT_A = "https://fonts.example/a.css";
const FONT_B = "https://fonts.example/b.css";

function makeShadowRoot(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

function links(id: string): HTMLLinkElement[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>(`link#${id}`)];
}

afterEach(() => {
  links(TENANT_LINK_ID).forEach((el) => {
    el.remove();
  });
  document.body.innerHTML = "";
});

describe("applyFontUrl", () => {
  it("injects the stylesheet link into document.head", () => {
    applyFontUrl(makeShadowRoot(), FONT_A);
    expect(links(TENANT_LINK_ID)).toHaveLength(1);
    expect(links(TENANT_LINK_ID)[0]?.rel).toBe("stylesheet");
    expect(links(TENANT_LINK_ID)[0]?.href).toBe(FONT_A);
  });

  it("reuses the same link element across calls", () => {
    const root = makeShadowRoot();
    applyFontUrl(root, FONT_A);
    const first = links(TENANT_LINK_ID)[0];
    applyFontUrl(root, FONT_A);
    applyFontUrl(root, FONT_B);
    expect(links(TENANT_LINK_ID)).toHaveLength(1);
    expect(links(TENANT_LINK_ID)[0]).toBe(first);
    expect(links(TENANT_LINK_ID)[0]?.href).toBe(FONT_B);
  });

  it("removes the link when called with null", () => {
    const root = makeShadowRoot();
    applyFontUrl(root, FONT_A);
    applyFontUrl(root, null);
    expect(links(TENANT_LINK_ID)).toHaveLength(0);
  });
});

/**
 * Shared-ownership semantics: several surfaces (`<zitadel-login>`,
 * `<zitadel-session>`) call this helper on every update with their own
 * desired state. A surface passing `null` withdraws only its own
 * registration — the historical single-owner behavior let a widget-mode
 * surface strip the font a page-mode surface had loaded.
 */
describe("shared link ownership across surfaces", () => {
  it("a surface without branding does not clear another surface's tenant font", () => {
    applyFontUrl(makeShadowRoot(), FONT_A);
    applyFontUrl(makeShadowRoot(), null);
    expect(links(TENANT_LINK_ID)[0]?.href).toBe(FONT_A);
  });

  it("removes the link only once every surface has withdrawn", () => {
    const first = makeShadowRoot();
    const second = makeShadowRoot();

    applyFontUrl(first, FONT_A);
    applyFontUrl(second, FONT_A);
    applyFontUrl(first, null);
    expect(links(TENANT_LINK_ID)).toHaveLength(1);

    applyFontUrl(second, null);
    expect(links(TENANT_LINK_ID)).toHaveLength(0);
  });

  it("the most recent registration wins, and withdrawal falls back", () => {
    const first = makeShadowRoot();
    const second = makeShadowRoot();

    applyFontUrl(first, FONT_A);
    applyFontUrl(second, FONT_B);
    expect(links(TENANT_LINK_ID)[0]?.href).toBe(FONT_B);

    // Withdrawing the active owner reverts the shared link to the remaining
    // registration instead of removing it.
    applyFontUrl(second, null);
    expect(links(TENANT_LINK_ID)[0]?.href).toBe(FONT_A);
  });

  it("a disconnected surface's registration is pruned, not honored forever", () => {
    const removed = makeShadowRoot();
    applyFontUrl(removed, FONT_A);
    removed.host.remove();
    links(TENANT_LINK_ID).forEach((el) => {
      el.remove();
    });

    // The stale registration must not resurrect the link on an unrelated
    // surface's withdrawal…
    applyFontUrl(makeShadowRoot(), null);
    expect(links(TENANT_LINK_ID)).toHaveLength(0);

    // …and a live surface's withdrawal wins over the ghost owner.
    const live = makeShadowRoot();
    applyFontUrl(live, FONT_A);
    applyFontUrl(live, null);
    expect(links(TENANT_LINK_ID)).toHaveLength(0);
  });
});
