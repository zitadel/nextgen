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
 * The counterpart of {@link onClient}, for props the browser assigns as element
 * properties (see `given.ts`): only the server renders them as attributes, since
 * an attribute written on the client would be taken for the element's default.
 */
export function onServer<T>(value: T): T | undefined {
  return typeof document === "undefined" ? value : undefined;
}
