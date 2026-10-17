/**
 * Assigns the given props to a widget element as properties, skipping unset
 * (`undefined`) ones. A Svelte prop binding assigns `undefined` too, which
 * overwrites the element's own default — an unset `heading` left the session
 * card with an empty "Signed in as" title. (A `{...spread}` would not do:
 * Svelte routes a spread element's props through attributes, lowercasing
 * camelCase names such as `suppressHeader`.)
 */
export function assignGiven(element: object, props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      (element as Record<string, unknown>)[key] = value;
    }
  }
}
