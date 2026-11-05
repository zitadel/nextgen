/**
 * Svelte writes a custom element's props into server markup as attributes, and
 * stringifies an object, so the `project` handle would render as
 * `project="[object Object]"`. The handle is a property-only value: it is left
 * out of the server markup (the browser assigns it as a property) and its fields
 * are written as the attributes the widget reads when it upgrades.
 */
export function onClient<T>(value: T): T | undefined {
  return typeof document === "undefined" ? undefined : value;
}

/**
 * An empty proxy path as `/`. A widget treats an empty `proxy-path` attribute
 * as unset and falls back to its default path, while `/` survives that and
 * normalizes to the site root.
 */
export function proxyPathAttr(path: string | undefined): string | undefined {
  return path === "" ? "/" : path;
}
