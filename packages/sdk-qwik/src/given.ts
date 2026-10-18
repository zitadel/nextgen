const defaults = new WeakMap<object, Map<string, unknown>>();

/**
 * Assigns the given props to a widget element as properties, leaving unset
 * (`undefined`) ones to the element's own defaults. Skipping an `undefined`
 * prop is not enough: one that goes back to unset would keep its last override
 * on the element — a cleared `heading` left the session card with its old
 * title.
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
