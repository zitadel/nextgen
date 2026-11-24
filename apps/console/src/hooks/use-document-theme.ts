import { useSyncExternalStore } from "react";

/**
 * The side `<html data-theme>` paints now, following the console's theme
 * toggle. Dark is the tokens' default, so anything but `light` is dark.
 */
export function useDocumentTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, read, () => "dark");
}

function read(): "light" | "dark" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
