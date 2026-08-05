import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Real-browser checks that the light theme actually paints.
 *
 * The base token sheet ships both modes (`:host` / `:host([data-theme=…])`
 * after the selector rewrite in `branding-to-tokens`), and the orchestrator
 * stamps the resolved mode on its own host element. Regression guard: the
 * atom-facing `--zl-color-*` tokens once lived only in the dark block, so
 * `data-theme="light"` resolved correctly while every surface stayed dark —
 * asserting the attribute alone would not have caught that.
 */

const identifierStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_1",
  step: {
    name: "identifier",
    texts: { title_key: "identifier.title" },
    fields: [
      { name: "email", type: "email", text_key: "identifier.field.email", required: true },
    ],
    actions: [{ name: "submit", kind: "submit", text_key: "submit.continue", primary: true }],
    gates: {},
  },
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

function installFlowFetchStub(responses: readonly CreateFlow201[]): { restore: () => void } {
  let cursor = 0;
  const fetchStub = vi.fn(async (): Promise<Response> => {
    const next = responses[Math.min(cursor, responses.length - 1)];
    cursor += 1;
    return new Response(JSON.stringify(next), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
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

describe("<zitadel-login> theming (chromium)", () => {
  let host: HTMLDivElement;
  let stub: ReturnType<typeof installFlowFetchStub> | undefined;
  let project: ZitadelProject;

  beforeEach(() => {
    _resetConfigForTesting();
    project = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "theme-test",
      url: "http://localhost:4000",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    stub?.restore();
    document.getElementById("zl-default-font-link")?.remove();
  });

  async function mount(configure?: (el: ZitadelLogin) => void): Promise<ZitadelLogin> {
    stub = installFlowFetchStub([identifierStep]);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = project;
    configure?.(element);
    host.appendChild(element);
    await waitFor(() => (element.shadowRoot?.querySelector("zl-field") ? element : null));
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return element;
  }

  /** Computed value of a token as the atoms see it, inside the shadow root. */
  function tokenValue(element: ZitadelLogin, name: string): string {
    const probe = element.shadowRoot?.querySelector(".zl-mount") as HTMLElement;
    return getComputedStyle(probe).getPropertyValue(name).trim();
  }

  it("theme=light repaints the atom-facing surface and text tokens", async () => {
    const element = await mount((el) => {
      el.theme = "light";
      el.variant = "page";
    });
    expect(element.dataset.theme).toBe("light");

    // Page surface becomes light and primary text becomes dark — the tokens
    // the atoms actually consume, not just the shadcn namespace.
    expect(tokenValue(element, "--zl-color-surface-default-black")).toBe("#f4f4f6");
    expect(tokenValue(element, "--zl-color-text-primary-white")).toBe("#0f0f11");
    // The card sits above the page, as in dark mode.
    expect(tokenValue(element, "--zl-color-surface-default-primary-gray")).toBe("#ffffff");
    // A focus ring the colour of dark-mode text would be invisible here.
    expect(tokenValue(element, "--zl-focus-color")).toBe("#0f0f11");

    // And it reaches real pixels: the page shell paints light.
    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;
    expect(luminance(getComputedStyle(surface).backgroundColor)).toBeGreaterThan(200);
    // Card text is dark, so it is legible on that light card.
    const card = element.shadowRoot?.querySelector(".zl-card-title") as HTMLElement;
    expect(luminance(getComputedStyle(card).color)).toBeLessThan(60);
  });

  it("theme=dark keeps the design system's primary surface", async () => {
    const element = await mount((el) => {
      el.theme = "dark";
      el.variant = "page";
    });
    expect(element.dataset.theme).toBe("dark");
    expect(tokenValue(element, "--zl-color-surface-default-black")).toBe("#0f0f11");
    expect(tokenValue(element, "--zl-color-text-primary-white")).toBe("#f4f4f6");
    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;
    expect(luminance(getComputedStyle(surface).backgroundColor)).toBeLessThan(60);
  });

  it("page mode defaults to dark; the element's theme beats tenant branding", async () => {
    const pageDefault = await mount((el) => {
      el.variant = "page";
    });
    expect(pageDefault.dataset.theme).toBe("dark");
    pageDefault.remove();
    stub?.restore();

    // Tenant branding says dark, the embedding page says light — the page wins.
    stub = installFlowFetchStub([
      {
        ...identifierStep,
        branding: { layout: "centered", theme: { mode: "dark" } },
      } as unknown as CreateFlow201,
    ]);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = project;
    element.theme = "light";
    host.appendChild(element);
    await waitFor(() => (element.shadowRoot?.querySelector("zl-field") ? element : null));
    await waitFor(() => (element.dataset.theme === "light" ? element : null));
    expect(element.dataset.theme).toBe("light");
  });
});
