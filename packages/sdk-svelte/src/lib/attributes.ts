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

/**
 * Returns the given attributes on the server and none in the browser.
 *
 * A prop the element has a property for, such as `variant`, `theme`, `lang` or `heading`, is
 * assigned as a property in the browser, where an unset value would overwrite the element's own
 * default. The browser assigns those through `assignGiven` instead, and this writes the same
 * values as attributes into server markup, where the widget reads them as it upgrades. An
 * `undefined` value writes no attribute.
 */
export function serverOnly(
  attributes: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return typeof document === "undefined" ? attributes : {};
}

/**
 * A boolean prop as a boolean attribute: present, as an empty string, when `true`, otherwise
 * omitted.
 */
export function flag(value: boolean | undefined): string | undefined {
  return value ? "" : undefined;
}
