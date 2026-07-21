/**
 * Console theming.
 *
 * The design tokens expose a dark `:root` and a light `[data-theme="light"]`
 * override (see `@zitadel/design-tokens`). We drive which one applies by
 * setting `data-theme` on `<html>`.
 *
 * Preference model:
 *   - `system` (default): follow the OS `prefers-color-scheme`.
 *   - `light` / `dark`: an explicit user override, persisted in localStorage.
 *
 * The initial `data-theme` is applied by a tiny inline script in `index.html`
 * before React hydrates (no flash of the wrong theme). This module keeps it in
 * sync afterwards and reacts to OS changes while the preference is `system`.
 */
import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "zl-console-theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* localStorage may be unavailable (SSR, privacy mode) */
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

function apply(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Subscribe to a MediaQueryList with the legacy addListener fallback. */
function subscribeMedia(mql: MediaQueryList, onChange: () => void): () => void {
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

export interface UseThemeResult {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

/**
 * Reads/writes the theme preference and keeps `data-theme` on `<html>` current.
 * While the preference is `system`, it re-resolves on OS scheme changes.
 */
export function useTheme(): UseThemeResult {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    apply(next);

    if (preference !== "system") return;
    const media = window.matchMedia(LIGHT_QUERY);
    const onChange = (): void => {
      const system = systemTheme();
      setResolved(system);
      apply(system);
    };
    return subscribeMedia(media, onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore persistence failures */
    }
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}
