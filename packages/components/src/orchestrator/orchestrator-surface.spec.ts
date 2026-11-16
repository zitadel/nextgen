import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { _resetConfigForTesting } from "@zitadel/api/config";

import { test } from "../test/fixtures.js";
import "./zitadel-login.js";
import "./zitadel-logout.js";
import "./zitadel-session.js";
import { ZitadelLogin } from "./zitadel-login.js";
import type { ZitadelLogout } from "./zitadel-logout.js";
import { ZitadelSession } from "./zitadel-session.js";

/**
 * jsdom-friendly conformance checks for the shared orchestrator surface
 * contract (`surface.ts`): `<zitadel-login>` and `<zitadel-session>` expose
 * the same `variant`/`theme` pair with the same defaults, and every
 * orchestrator element (logout included) resolves an explicit `theme` to the
 * `data-theme` host stamp the token sheets key off. Explicit modes bypass
 * `matchMedia`, so these assertions don't depend on jsdom's media-query
 * stub. Real-pixel consequences live in the browser suites
 * (`embedding.browser.spec.ts`, `theme.browser.spec.ts`,
 * `session-surface.browser.spec.ts`).
 */

/**
 * `it` that takes the tenant font link out of the document head once the test
 * ends, whatever the test left there.
 */
const it = test.extend<{ fontLink: undefined }>({
  fontLink: [
    // biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument.
    async ({}, use) => {
      await use(undefined);
      document.getElementById("zl-font-link")?.remove();
    },
    { auto: true },
  ],
});

describe("orchestrator surface contract", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // No SDK config on purpose: `<zitadel-login>` renders its startup error
    // (silenced below) and the session/logout identity fetch no-ops — no
    // network needed to assert the surface contract.
    _resetConfigForTesting();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(
    host: HTMLElement,
    tag: string,
    configure?: (el: T) => void,
  ): Promise<T> {
    const element = document.createElement(tag) as T;
    configure?.(element);
    host.appendChild(element);
    await element.updateComplete;
    return element;
  }

  describe.each([
    ["zitadel-login", ZitadelLogin],
    ["zitadel-session", ZitadelSession],
  ] as const)("<%s>", (tag, ctor) => {
    it("declares variant and theme as public reactive properties", () => {
      // Force Lit finalization so `elementProperties` is fully populated
      // even if a decorator flavour defers it to first construction.
      document.createElement(tag);
      const variant = ctor.elementProperties.get("variant");
      const theme = ctor.elementProperties.get("theme");
      expect(variant).toBeDefined();
      expect(variant?.state).not.toBe(true);
      expect(theme).toBeDefined();
      expect(theme?.state).not.toBe(true);
    });

    it("defaults to the content-sized widget with no stated theme", async ({ host }) => {
      const element = await mount<ZitadelLogin | ZitadelSession>(host, tag);
      expect(element.variant).toBe("widget");
      expect(element.theme).toBe("");
      // `variant` reflects so host pages can select on it.
      expect(element.getAttribute("variant")).toBe("widget");
    });

    it("stamps an explicit theme onto the host", async ({ host }) => {
      const element = await mount<ZitadelLogin | ZitadelSession>(host, tag, (el) => {
        el.theme = "light";
      });
      expect(element.dataset.theme).toBe("light");
      expect(element.hasAttribute("data-theme-dark")).toBe(false);

      element.theme = "dark";
      await element.updateComplete;
      expect(element.dataset.theme).toBe("dark");
      expect(element.hasAttribute("data-theme-dark")).toBe(true);
    });

    it("page variant defaults to the dark design-system surface", async ({ host }) => {
      const element = await mount<ZitadelLogin | ZitadelSession>(host, tag, (el) => {
        el.variant = "page";
      });
      expect(element.dataset.theme).toBe("dark");
      expect(element.hasAttribute("data-theme-dark")).toBe(true);
    });
  });

  it("<zitadel-session> stamps widget polarity on its page shell", async ({ host }) => {
    const element = await mount<ZitadelSession>(host, "zitadel-session");
    const shell = element.shadowRoot?.querySelector("zl-page-shell");
    expect(shell?.hasAttribute("data-widget")).toBe(true);

    element.variant = "page";
    await element.updateComplete;
    expect(shell?.hasAttribute("data-widget")).toBe(false);
  });

  it("an unbranded page surface links no font stylesheet", async ({ host }) => {
    // The package loads no face of its own: without a tenant `font_url` the
    // token stack falls back to the system font, so no visitor's address
    // reaches a font CDN by default (ADR 025, amended).
    await mount<ZitadelSession>(host, "zitadel-session", (el) => {
      el.variant = "page";
    });
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it("<zitadel-logout> resolves an explicit theme instead of pinning dark", async ({ host }) => {
    const element = await mount<ZitadelLogout>(host, "zitadel-logout", (el) => {
      el.theme = "light";
    });
    expect(element.dataset.theme).toBe("light");
    expect(element.hasAttribute("data-theme-dark")).toBe(false);

    element.theme = "dark";
    await element.updateComplete;
    expect(element.dataset.theme).toBe("dark");
    expect(element.hasAttribute("data-theme-dark")).toBe(true);
  });

  it("<zitadel-login> keeps the header shown and stable when suppressHeader is unset", async ({
    host,
  }) => {
    const element = await mount<ZitadelLogin>(host, "zitadel-login");
    // The card paints after the element's first async render, so wait for it.
    const card = await vi.waitUntil(() => element.shadowRoot?.querySelector("zl-card"));

    // A framework wrapper that binds an unset optional prop (e.g. Angular's
    // [suppressHeader]) assigns `undefined` to the element through the untyped
    // DOM boundary. "Unset" must mean "show the header".
    element.suppressHeader = undefined as unknown as boolean;

    // Re-render twice: the header must stay shown both times, never toggling.
    element.requestUpdate();
    await element.updateComplete;
    expect(card.hasAttribute("data-suppress-header")).toBe(false);

    element.requestUpdate();
    await element.updateComplete;
    expect(card.hasAttribute("data-suppress-header")).toBe(false);
  });
});
