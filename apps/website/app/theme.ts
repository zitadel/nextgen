// The page's theme, light or dark, as data-theme on <html> (globals.css):
// the visitor's choice from the header's toggle (theme-toggle.tsx), kept in
// localStorage under THEME_KEY, or else their system's. A module of its own,
// without "use client", so the layout can inline the script.
export const THEME_KEY = "theme";

/**
 * Run in <head> before the first paint, so the page never flashes the other
 * theme: applies the choice, or follows the system while there is none.
 */
export const THEME_SCRIPT = `(() => {
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: light)");
  const apply = () => {
    let choice = null;
    try { choice = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch {}
    root.dataset.theme = choice || (system.matches ? "light" : "dark");
  };
  apply();
  system.addEventListener("change", apply);
})();`;
