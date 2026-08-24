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
 * atom-facing tokens once lived only in the dark block, so
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
/**
 * 0–255 channels from any colour Chrome hands back. `rgb()` already uses that
 * range, but a computed `color-mix()` serialises as `color(srgb r g b)` with
 * 0–1 channels — read naively, every mixed colour reads as near-black and a
 * contrast assertion fails for a reason that has nothing to do with the design.
 */
function channels(color: string): [number, number, number] {
  const scale = color.startsWith("color(") ? 255 : 1;
  const parts = (color.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3);
  return parts.map((part) => Number(part) * scale) as [number, number, number];
}

function luminance(color: string): number {
  const [r, g, b] = channels(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG relative luminance. */
function relativeLuminance(color: string): number {
  const [r, g, b] = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `rgb()` strings, 1 (identical) – 21. */
function contrast(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
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

    // Page surface becomes light and primary text becomes dark.
    expect(tokenValue(element, "--zl-background")).toBe("#fafafa");
    expect(tokenValue(element, "--zl-foreground")).toBe("#0a0a0a");
    // The card sits above the page, as in dark mode.
    expect(tokenValue(element, "--zl-card")).toBe("#ffffff");
    // A focus ring the colour of the dark-mode ring would be invisible here.
    expect(tokenValue(element, "--zl-ring")).toBe("#a3a3a3");

    // And it reaches real pixels: the page shell paints light.
    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;
    expect(luminance(getComputedStyle(surface).backgroundColor)).toBeGreaterThan(200);
    // Card text is dark, so it is legible on that light card.
    const card = element.shadowRoot?.querySelector(".zl-card-title") as HTMLElement;
    expect(luminance(getComputedStyle(card).color)).toBeLessThan(60);
  });

  /**
   * Interactive states are where light mode actually broke: the resting
   * tokens above all flipped, but the hover/pressed fills read the raw grey
   * ramp, which is mode-independent — so a light page kept dark-mode fills
   * under dark-mode text (primary hover measured 1.4:1). Asserting resting
   * colours alone never caught it, so drive the states and measure contrast.
   */
  for (const theme of ["light", "dark"] as const) {
    it(`theme=${theme} keeps every button state legible`, async () => {
      const element = await mount((el) => {
        el.theme = theme;
        el.variant = "page";
      });
      // The step gates its submit action on the required field, and the
      // hover/pressed rules are all `:not(:disabled)` — measuring a gated
      // button silently reads the resting colours instead.
      const field = element.shadowRoot?.querySelector("zl-field") as HTMLElement;
      const input = field.shadowRoot?.querySelector(".zr-field__input") as HTMLInputElement;
      input.value = "user@example.com";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

      const button = element.shadowRoot?.querySelector("zl-button") as HTMLElement & {
        updateComplete: Promise<boolean>;
      };
      await button.updateComplete;
      const painted = button.shadowRoot?.querySelector(".zr-btn") as HTMLButtonElement;
      expect(painted.disabled, `${theme}: submit still gated, states would not paint`).toBe(false);
      // The surface transitions `background-color` over `--zl-duration-fast`,
      // so a computed read straight after the state flip samples the *old*
      // colour mid-interpolation — and the assertion passes on the resting
      // fill it was meant to look past.
      painted.style.transition = "none";

      for (const state of ["hovered", "pressed", "focused"]) {
        button.setAttribute("data-state", state);
        // The atom mirrors `data-state` onto the painted element on its next
        // render, so wait for it rather than measuring the previous paint.
        await button.updateComplete;
        const surface = button.shadowRoot?.querySelector(`.zr-btn[data-state="${state}"]`);
        expect(surface, `${theme} / ${state}: atom did not mirror data-state`).toBeTruthy();

        const style = getComputedStyle(surface as HTMLElement);
        expect(
          contrast(style.backgroundColor, style.color),
          `${theme} / ${state}: ${style.backgroundColor} on ${style.color}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  /**
   * The trustmark painted itself from hardcoded dark literals, so it stayed a
   * dark slab on a light page whatever the theme resolved to. It is plain text
   * on the `foreground` role now, and the logotype inherits that colour.
   */
  it("theme=light darkens the trustmark so it reads on a light page", async () => {
    const element = await mount((el) => {
      el.theme = "light";
      el.variant = "page";
    });
    const mark = element.shadowRoot?.querySelector(".zl-trustmark__mark") as HTMLElement;
    expect(mark).toBeTruthy();
    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;

    const style = getComputedStyle(mark);
    expect(luminance(style.color)).toBeLessThan(100);
    expect(contrast(getComputedStyle(surface).backgroundColor, style.color)).toBeGreaterThanOrEqual(
      4.5,
    );
    // `fill="currentColor"` on the logotype, so the mark's colour carries it.
    const logotype = mark.querySelector(".zl-trustmark__logotype-svg") as SVGElement;
    expect(logotype).toBeTruthy();
    expect(getComputedStyle(logotype).fill).toBe(style.color);
  });

  /**
   * The card drew its edge from its own *surface* token, which happens to
   * differ from the page in dark mode but resolves to the card fill in light
   * — a white border on a white card, invisible against the page.
   */
  for (const theme of ["light", "dark"] as const) {
    it(`theme=${theme} keeps the card edge distinct from the surfaces it separates`, async () => {
      const element = await mount((el) => {
        el.theme = theme;
        el.variant = "page";
      });
      const card = element.shadowRoot?.querySelector("zl-card") as HTMLElement;
      const surface = card.shadowRoot?.querySelector(".zr-card") as HTMLElement;
      const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
      const page = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;

      const border = luminance(getComputedStyle(surface).borderTopColor);
      const pageBg = luminance(getComputedStyle(page).backgroundColor);

      // Direction, not distance: the edge has to step *away* from the page —
      // darker on a light page, lighter on a dark one. A distance check would
      // have passed the regression, whose white border sat 11 points off a
      // near-white page. Dark mode hid the bug because the card's surface and
      // border tokens happen to share a value there (#252528).
      const separation = theme === "light" ? pageBg - border : border - pageBg;
      expect(
        separation,
        `${theme}: card border (${border.toFixed(0)}) does not step away from the page (${pageBg.toFixed(0)})`,
      ).toBeGreaterThan(4);
    });
  }

  it("theme=dark keeps the design system's primary surface", async () => {
    const element = await mount((el) => {
      el.theme = "dark";
      el.variant = "page";
    });
    expect(element.dataset.theme).toBe("dark");
    expect(tokenValue(element, "--zl-background")).toBe("#050505");
    expect(tokenValue(element, "--zl-foreground")).toBe("#fafafa");
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
