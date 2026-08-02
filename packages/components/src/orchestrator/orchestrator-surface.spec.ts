import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetConfigForTesting } from "@zitadel/api/config";

import "./zitadel-login.js";
import "./zitadel-logout.js";
import "./zitadel-session.js";
import { ZitadelLogin } from "./zitadel-login.js";
import { ZitadelLogout } from "./zitadel-logout.js";
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

describe("orchestrator surface contract", () => {
  let host: HTMLDivElement;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // No SDK config on purpose: `<zitadel-login>` renders its startup error
    // (silenced below) and the session/logout identity fetch no-ops — no
    // network needed to assert the surface contract.
    _resetConfigForTesting();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    consoleError.mockRestore();
    // Page-variant mounts inject the document-level default-font link.
    document.getElementById("zl-default-font-link")?.remove();
  });

  async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(
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

    it("defaults to the content-sized widget with no stated theme", async () => {
      const element = await mount<ZitadelLogin | ZitadelSession>(tag);
      expect(element.variant).toBe("widget");
      expect(element.theme).toBe("");
      // `variant` reflects so host pages can select on it.
      expect(element.getAttribute("variant")).toBe("widget");
    });

    it("stamps an explicit theme onto the host", async () => {
      const element = await mount<ZitadelLogin | ZitadelSession>(tag, (el) => {
        el.theme = "light";
      });
      expect(element.dataset.theme).toBe("light");
      expect(element.hasAttribute("data-theme-dark")).toBe(false);

      element.theme = "dark";
      await element.updateComplete;
      expect(element.dataset.theme).toBe("dark");
      expect(element.hasAttribute("data-theme-dark")).toBe(true);
    });

    it("page variant defaults to the dark design-system surface", async () => {
      const element = await mount<ZitadelLogin | ZitadelSession>(tag, (el) => {
        el.variant = "page";
      });
      expect(element.dataset.theme).toBe("dark");
      expect(element.hasAttribute("data-theme-dark")).toBe(true);
    });
  });

  it("<zitadel-session> stamps widget polarity on its page shell", async () => {
    const element = await mount<ZitadelSession>("zitadel-session");
    const shell = element.shadowRoot?.querySelector("zl-page-shell");
    expect(shell?.hasAttribute("data-widget")).toBe(true);

    element.variant = "page";
    await element.updateComplete;
    expect(shell?.hasAttribute("data-widget")).toBe(false);
  });

  it("a widget surface leaves another surface's default font link alone", async () => {
    // Page-variant session ships the brand font; mounting a widget next to it
    // (which never wants the default font) must not strip that link.
    await mount<ZitadelSession>("zitadel-session", (el) => {
      el.variant = "page";
    });
    expect(document.getElementById("zl-default-font-link")).not.toBeNull();

    await mount<ZitadelSession>("zitadel-session");
    expect(document.getElementById("zl-default-font-link")).not.toBeNull();
  });

  it("<zitadel-logout> resolves an explicit theme instead of pinning dark", async () => {
    const element = await mount<ZitadelLogout>("zitadel-logout", (el) => {
      el.theme = "light";
    });
    expect(element.dataset.theme).toBe("light");
    expect(element.hasAttribute("data-theme-dark")).toBe(false);

    element.theme = "dark";
    await element.updateComplete;
    expect(element.dataset.theme).toBe("dark");
    expect(element.hasAttribute("data-theme-dark")).toBe(true);
  });
});
