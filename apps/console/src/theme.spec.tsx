import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY, useTheme } from "./theme";

/**
 * The theme is declared to the browser as well as applied to the page: what a
 * browser draws around the page takes its colour from `color-scheme` and
 * `theme-color`, so both have to follow the theme in use, a manual choice
 * against the OS included.
 */
const meta = (name: string) =>
  document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

describe("theme", () => {
  let tokens: HTMLStyleElement;

  beforeEach(() => {
    // The two page backgrounds, as the design tokens' stylesheet scopes them.
    tokens = document.createElement("style");
    tokens.textContent =
      ':root { --zl-background: #050505; } :root[data-theme="light"] { --zl-background: #fafafa; }';
    document.head.append(tokens);
  });

  afterEach(() => {
    tokens.remove();
    for (const name of ["color-scheme", "theme-color"]) {
      document.head.querySelector(`meta[name="${name}"]`)?.remove();
    }
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it("declares the theme in use to the browser, and follows a switch", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(meta("color-scheme")).toBe("dark");
    expect(meta("theme-color")).toBe("#050505");

    act(() => result.current.setPreference("light"));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(meta("color-scheme")).toBe("light");
    expect(meta("theme-color")).toBe("#fafafa");
    // One of each, updated in place.
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="color-scheme"]')).toHaveLength(1);
  });

  it("leaves theme-color unset while the tokens have not loaded", () => {
    tokens.remove();
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderHook(() => useTheme());

    expect(meta("color-scheme")).toBe("dark");
    expect(meta("theme-color")).toBeUndefined();
  });
});
