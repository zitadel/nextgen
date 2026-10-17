import { CONFIG_CHANGE_EVENT } from "@zitadel/api/config";

/**
 * Re-exported from `@zitadel/api/config`, which dispatches it on `globalThis`
 * when `configureZitadel()` stores a project handle. An element that found no
 * config when it started listens for it to try again.
 */
export { CONFIG_CHANGE_EVENT };

/** Subscribes to {@link CONFIG_CHANGE_EVENT}; returns the unsubscribe. */
export function onConfigChange(listener: () => void): () => void {
  if (typeof globalThis.addEventListener !== "function") return () => {};
  globalThis.addEventListener(CONFIG_CHANGE_EVENT, listener);
  return () => globalThis.removeEventListener(CONFIG_CHANGE_EVENT, listener);
}
