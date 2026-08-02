import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-session.js";
import type { ZitadelSession } from "./zitadel-session.js";

/**
 * Real-browser checks for the `<zitadel-session>` embedding contract,
 * mirroring the `<zitadel-login>` widget-first suite: the default
 * `variant="widget"` is content-sized and transparent through every layer
 * (host, `zl-page-shell` host, inner `.zr-page-shell`), while
 * `variant="page"` claims the viewport and paints the surface — on the
 * internal page shell, since the session host itself no longer carries the
 * page paint. Theme resolution reaches real pixels the same way as the
 * login surface.
 */

const TRANSPARENT = "rgba(0, 0, 0, 0)";

const sessionBody = {
  session_id: "sess_1",
  project_id: "session-surface-test",
  state: "active",
  user_id: "user_1",
  email: "alice@acme.com",
  factors: [],
  assurance_levels: [],
};

/** Perceived lightness of a `rgb(r, g, b)` string, 0 (black) – 255 (white). */
function luminance(color: string): number {
  const [r, g, b] = (color.match(/\d+/g) ?? ["0", "0", "0"]).map(Number) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function installSessionFetchStub(): { restore: () => void } {
  const fetchStub = vi.fn(
    async (): Promise<Response> =>
      new Response(JSON.stringify(sessionBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

async function waitFor<T>(probe: () => T | null | undefined, timeout = 3000): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

describe("<zitadel-session> surface (chromium)", () => {
  let host: HTMLDivElement;
  let stub: ReturnType<typeof installSessionFetchStub> | undefined;
  let project: ZitadelProject;

  beforeEach(() => {
    _resetConfigForTesting();
    project = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "session-surface-test",
      url: "http://localhost:4000",
    });
    host = document.createElement("div");
    host.style.width = "360px";
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    stub?.restore();
    document.getElementById("zl-default-font-link")?.remove();
  });

  async function mount(configure?: (el: ZitadelSession) => void): Promise<ZitadelSession> {
    stub = installSessionFetchStub();
    const element = document.createElement("zitadel-session") as ZitadelSession;
    element.project = project;
    configure?.(element);
    host.appendChild(element);
    await waitFor(() => (element.shadowRoot?.querySelector("zl-page-shell") ? element : null));
    // Let the identity fetch and follow-up render settle before asserting.
    await waitFor(() => element.shadowRoot?.querySelector(".identity"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    return element;
  }

  it("widget default: content-sized, and transparent through every layer", async () => {
    const element = await mount();
    expect(element.getAttribute("variant")).toBe("widget");

    const rect = element.getBoundingClientRect();
    expect(rect.height).toBeGreaterThan(0);

    // No footer content on this surface, so content-sized is exact: the
    // host box IS the card box. Shell padding leaking into widget mode
    // (the 682px-host / 514px-card dead space) fails this directly.
    const card = element.shadowRoot?.querySelector("zl-card") as HTMLElement;
    expect(card).toBeTruthy();
    expect(Math.abs(card.getBoundingClientRect().height - rect.height)).toBeLessThanOrEqual(1);

    // Outer host.
    expect(getComputedStyle(element).backgroundColor).toBe(TRANSPARENT);
    // Inner layers, matching the login suite's every-layer assertion.
    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    expect(shell).toBeTruthy();
    expect(shell.hasAttribute("data-widget")).toBe(true);
    expect(getComputedStyle(shell).backgroundColor).toBe(TRANSPARENT);
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;
    expect(surface).toBeTruthy();
    expect(getComputedStyle(surface).backgroundColor).toBe(TRANSPARENT);
    expect(getComputedStyle(surface).padding).toBe("0px");

    // Widget mode injects no design-system font into the host document.
    expect(document.getElementById("zl-default-font-link")).toBeNull();
  });

  it("variant=page claims the viewport and paints the shell dark by default", async () => {
    const element = await mount((el) => {
      el.variant = "page";
    });
    expect(element.dataset.theme).toBe("dark");

    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    expect(shell.hasAttribute("data-widget")).toBe(false);
    // The page paint lives on the internal page shell, not the session host.
    expect(element.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      window.innerHeight - 1,
    );
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;
    expect(luminance(getComputedStyle(surface).backgroundColor)).toBeLessThan(60);

    // Page mode ships the brand font, matching the login surface.
    expect(document.getElementById("zl-default-font-link")).not.toBeNull();
  });

  it("theme=light repaints the page surface and card text", async () => {
    const element = await mount((el) => {
      el.variant = "page";
      el.theme = "light";
    });
    expect(element.dataset.theme).toBe("light");

    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;
    expect(luminance(getComputedStyle(surface).backgroundColor)).toBeGreaterThan(200);
    // Title and identity text flip dark so they read on the light card.
    const title = element.shadowRoot?.querySelector(".title") as HTMLElement;
    expect(luminance(getComputedStyle(title).color)).toBeLessThan(60);
    const identity = element.shadowRoot?.querySelector(".identity") as HTMLElement;
    expect(luminance(getComputedStyle(identity).color)).toBeLessThan(150);
  });
});
