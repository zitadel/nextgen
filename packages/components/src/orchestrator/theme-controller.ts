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

/** Theme inputs a caller may express, before resolution. */
export type ThemeMode = "light" | "dark" | "auto";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export class ThemeController implements ReactiveController {
  private readonly host: ReactiveControllerHost;

  private branding: Branding | undefined;

  /** Element-level `theme` property — the embedding developer's explicit call. */
  private explicitMode: ThemeMode | undefined;

  /** Used when neither the element nor the branding payload names a mode. */
  private fallbackMode: ThemeMode = "dark";

  private mediaQuery: MediaQueryList | null = null;

  // Initial value before the first resolve; dark is the design system's
  // primary surface. Both modes ship real token values.
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

  /**
   * Sets the element-level preference and the fallback used when neither the
   * element nor the branding payload names a mode. Precedence, strongest
   * first: element `theme` property → `branding.theme.mode` → fallback. The
   * element wins because the page embedding the widget knows its own surface
   * better than the tenant's stored branding does.
   */
  setModePreference(explicit: ThemeMode | undefined, fallback: ThemeMode): void {
    if (this.explicitMode === explicit && this.fallbackMode === fallback) return;
    this.explicitMode = explicit;
    this.fallbackMode = fallback;
    this.refresh();
  }

  hostConnected(): void {
    this.refresh();
  }

  hostDisconnected(): void {
    this.detach();
  }

  private refresh(): void {
    const mode = this.explicitMode ?? this.branding?.theme?.mode ?? this.fallbackMode;
    if (mode === "auto") {
      this.attach();
      // Follow `prefers-color-scheme`. Where `matchMedia` is unavailable the
      // preference is unknowable, so fall back to the design system's
      // primary surface rather than guessing light.
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
