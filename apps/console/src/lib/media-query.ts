/** Subscribes to a `MediaQueryList`, with the legacy `addListener` fallback. */
export function subscribeMedia(mql: MediaQueryList, onChange: () => void): () => void {
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}
