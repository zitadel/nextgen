const defaults = new WeakMap<object, Map<string, unknown>>();

/**
 * Assigns the given props to a widget element as properties, leaving unset
 * (`undefined`) ones to the element's own defaults. A Svelte prop binding
 * assigns `undefined` too, which overwrites the element's default — an unset
 * `heading` left the session card with an empty "Signed in as" title. (A
 * `{...spread}` would not do: Svelte routes a spread element's props through
 * attributes, lowercasing camelCase names such as `suppressHeader`.)
 *
 * The element's own value is remembered before a prop is first overridden and
 * restored when the prop becomes unset again, so a reactive prop going from a
 * value back to `undefined` does not leave the stale override in place.
 */
export function assignGiven(element: object, props: Record<string, unknown>): void {
  const target = element as Record<string, unknown>;
  let saved = defaults.get(element);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      if (!saved) {
        saved = new Map();
        defaults.set(element, saved);
      }
      if (!saved.has(key)) {
        saved.set(key, target[key]);
      }
      target[key] = value;
    } else if (saved?.has(key)) {
      target[key] = saved.get(key);
      saved.delete(key);
    }
  }
}
