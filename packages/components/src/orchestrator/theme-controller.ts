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

import type { Branding } from "./types.js";

export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export class ThemeController implements ReactiveController {
  private readonly host: ReactiveControllerHost;

  private branding: Branding | undefined;

  private mediaQuery: MediaQueryList | null = null;

  private _theme: ResolvedTheme = "light";

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
    const mode = this.branding?.theme?.mode ?? "light";
    if (mode === "auto") {
      this.attach();
      this.update(this.mediaQuery?.matches ? "dark" : "light");
      return;
    }
    this.detach();
    this.update(mode === "dark" ? "dark" : "light");
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
    this.update(event.matches ? "dark" : "light");
  };

  private update(next: ResolvedTheme): void {
    if (this._theme === next) return;
    this._theme = next;
    this.host.requestUpdate();
  }
}
