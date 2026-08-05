import { LitElement } from "lit";
import { property } from "lit/decorators.js";

import type { Branding } from "./branding.js";
import { applyBaseTokens, applyBrandingTokens } from "./branding-to-tokens.js";
import { applyDefaultFont, applyFontUrl } from "./font-loader.js";
import { ThemeController, type ThemeMode } from "./theme-controller.js";

/**
 * Shared base for the orchestrator host elements (`<zitadel-login>`,
 * `<zitadel-session>`) that render a themable page/widget surface.
 *
 * Owns the `variant` / `theme` public properties, the {@link ThemeController},
 * and the per-update surface application (base tokens, branding overrides,
 * font links, and the `data-theme` host stamp). Subclasses call
 * {@link applySurfaceTheme} from their `willUpdate` so the resolved theme is
 * committed in the same update cycle that reads it.
 *
 * Not a registered custom element — purely an implementation-sharing base.
 */
export class ZitadelSurface extends LitElement {
  /**
   * Sizing/chrome mode. Components size to content; pages compose them —
   * so the default is `widget`: content-sized, transparent host, no
   * document-level default-font injection. Dedicated routes — the hosted
   * shell and the scaffolded pages — opt into `page`, which claims the
   * viewport, paints the surface background, and ships the brand font.
   * Fine-grained height override in both modes: `--zl-page-min-height`.
   */
  @property({ type: String, reflect: true }) accessor variant: "widget" | "page" = "widget";

  /**
   * Colour mode: `light`, `dark`, or `auto` (follow `prefers-color-scheme`).
   * Empty means "not stated", and resolution falls through to the tenant's
   * `branding.theme.mode`, then to a variant-derived default — `dark` for
   * `page` (the hosted design system surface) and `auto` for `widget`, so an
   * embedded widget matches the visitor's preference instead of forcing a
   * dark card onto a light page. Set it explicitly when your app's surface
   * is fixed: `<zitadel-login theme="light">`.
   */
  @property({ type: String }) accessor theme: "" | ThemeMode = "";

  protected readonly themeController = new ThemeController(this);

  /**
   * Resolve the active theme and commit it to this element's surface: adopt
   * the base token sheet, layer the branding overrides, manage the
   * document-level font links, and stamp `data-theme` / `data-theme-dark` on
   * the host so token lookups (and host-page selectors) flip with the mode.
   * `branding` is `undefined` for surfaces without a tenant payload — the
   * theme then resolves through the element preference and variant fallback.
   */
  protected applySurfaceTheme(branding: Branding | undefined): void {
    // Resolve before reading `themeController.theme` below: a page owns its
    // surface (dark), a widget defers to the visitor's preference (auto).
    this.themeController.setModePreference(
      this.theme === "" ? undefined : this.theme,
      this.variant === "page" ? "dark" : "auto",
    );
    const root = this.shadowRoot;
    if (root) {
      applyBaseTokens(root);
      applyBrandingTokens(root, branding, this.themeController.theme);
      // Ship the design-system brand face by default on dedicated pages;
      // drop it when a tenant font takes over so we don't fire a redundant
      // request. Widget mode never injects the default into the host
      // document — the embedding app owns its typography (and its visitors'
      // font-CDN connections). Tenant `font_url` is explicit server-side
      // branding state, so it applies in both modes.
      const tenantFontUrl = branding?.font_url ?? null;
      applyDefaultFont(root, this.variant === "page" && !tenantFontUrl ? undefined : null);
      applyFontUrl(root, tenantFontUrl);
    }
    this.dataset.theme = this.themeController.theme;
    this.toggleAttribute("data-theme-dark", this.themeController.theme === "dark");
  }
}
