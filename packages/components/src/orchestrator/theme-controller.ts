/**
 * `ThemeController` — Lit ReactiveController that resolves the active
 * `light | dark` theme from the current `Branding` payload and keeps it in
 * sync with the OS-level `prefers-color-scheme` when the tenant opts into
 * `theme.mode = "auto"`.
 *
 * Per `docs/design/branding/tokens.md` the orchestrator owns theming entirely.
 * Subscribing here is what makes "auto" actually reactive instead of a
 * one-shot read at first paint.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { Branding } from "./branding.js";

export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export class ThemeController implements ReactiveController {
  private readonly host: ReactiveControllerHost;

  private branding: Branding | undefined;

  private mediaQuery: MediaQueryList | null = null;

  // Default surface is dark — the design system only publishes a dark
  // variable mode today. See `branding-to-tokens.resolveTheme` for the
  // matching logic on the orchestrator side.
  private _theme: ResolvedTheme = "dark";

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  get theme(): ResolvedTheme {
    return this._theme;
  }

  setBranding(branding: Branding | undefined): void {
    this.branding = branding;
    this.refresh();
  }

  hostConnected(): void {
    this.refresh();
  }

  hostDisconnected(): void {
    this.detach();
  }

  private refresh(): void {
    const mode = this.branding?.theme?.mode ?? "dark";
    if (mode === "auto") {
      this.attach();
      // When tenants opt into auto and the OS preference is unknown, we
      // bias toward dark since that's the only mode the design system
      // currently publishes.
      this.update(this.mediaQuery?.matches === false ? "light" : "dark");
      return;
    }
    this.detach();
    this.update(mode === "light" ? "light" : "dark");
  }

  private attach(): void {
    if (this.mediaQuery || typeof matchMedia !== "function") return;
    this.mediaQuery = matchMedia(DARK_QUERY);
    this.mediaQuery.addEventListener("change", this.onMediaChange);
  }

  private detach(): void {
    if (!this.mediaQuery) return;
    this.mediaQuery.removeEventListener("change", this.onMediaChange);
    this.mediaQuery = null;
  }

  private onMediaChange = (event: MediaQueryListEvent): void => {
    // Auto-mode follows prefers-color-scheme. We watch the dark query, so
    // `matches=true` ⇒ user wants dark.
    this.update(event.matches ? "dark" : "light");
  };

  private update(next: ResolvedTheme): void {
    if (this._theme === next) return;
    this._theme = next;
    this.host.requestUpdate();
  }
}
