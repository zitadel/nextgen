import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyBaseTokens, applyBrandingTokens } from "../orchestrator/branding-to-tokens.js";
import type { Branding, BrandingPalette } from "../orchestrator/branding.js";

import "./zl-sso-providers.js";
import type { ZlSsoProviders } from "./zl-sso-providers.js";

/**
 * Provider buttons paint from `--zl-provider*`, which the tenant palette never
 * names, so a vendor's mark never lands on a brand-coloured fill. This pins it
 * the way it actually ships: the base token sheet and a tenant's branding
 * sheet adopted onto a shadow root, as `<zitadel-login>` does, with every
 * palette key set. Computed colours need real layout, hence chromium.
 */

const TENANT_RED = "#ff0000";

/** Every palette key a tenant can set, all red — the worst case for leakage. */
const LOUD_PALETTE: BrandingPalette = {
  primary: TENANT_RED,
  on_primary: TENANT_RED,
  background: TENANT_RED,
  surface: TENANT_RED,
  muted: TENANT_RED,
  border: TENANT_RED,
  text: TENANT_RED,
  text_muted: TENANT_RED,
  link: TENANT_RED,
  success: TENANT_RED,
  warning: TENANT_RED,
  error: TENANT_RED,
};

const LOUD_BRANDING = {
  theme: { light: { palette: LOUD_PALETTE }, dark: { palette: LOUD_PALETTE } },
} as Branding;

type Paint = { background: string; border: string; label: string };

describe("<zl-sso-providers> branding isolation (chromium)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function paint(theme: "light" | "dark", branding: Branding | undefined): Promise<Paint> {
    host.replaceChildren();
    const surface = document.createElement("div");
    surface.setAttribute("data-theme", theme);
    host.appendChild(surface);
    const root = surface.attachShadow({ mode: "open" });
    applyBaseTokens(root);
    applyBrandingTokens(root, branding);
    root.innerHTML = `<zl-sso-providers providers='[{"id":"idp_google","name":"Google","template":"google"}]'></zl-sso-providers>`;

    const sso = root.querySelector("zl-sso-providers") as ZlSsoProviders;
    await sso.updateComplete;
    const button = sso.shadowRoot!.querySelector("zl-button")!;
    await (button as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const inner = getComputedStyle(button.shadowRoot!.querySelector("button")!);
    const label = getComputedStyle(sso.shadowRoot!.querySelector(".zr-sso__label")!);
    return { background: inner.backgroundColor, border: inner.borderTopColor, label: label.color };
  }

  it.each(["light", "dark"] as const)(
    "keeps the %s provider button off the tenant palette",
    async (theme) => {
      const shipped = await paint(theme, undefined);
      const branded = await paint(theme, LOUD_BRANDING);

      expect(branded).toEqual(shipped);
      for (const colour of Object.values(branded)) {
        expect(colour).not.toBe("rgb(255, 0, 0)");
      }
    },
  );

  it("still lets the branding reach the rest of the surface", async () => {
    // Guards the test itself: if the branding sheet stopped applying, the
    // isolation assertion above would pass vacuously.
    await paint("light", LOUD_BRANDING);
    const surface = host.firstElementChild as HTMLElement;
    const probe = document.createElement("span");
    probe.style.color = "var(--zl-foreground)";
    surface.shadowRoot!.appendChild(probe);
    expect(getComputedStyle(probe).color).toBe("rgb(255, 0, 0)");
  });
});
