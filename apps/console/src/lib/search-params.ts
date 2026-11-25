/** A raw search param as a string, or `undefined` when it is absent or not one. */
export function stringParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * What a URL's `q` searches for: nothing unless it is text with more than
 * spaces in it. The router reads a hand-typed `?q=12345` as a number, which is
 * still what someone is looking for: a phone number, a numeric name.
 */
export function searchTerm(q: unknown): string | undefined {
  const text = typeof q === "number" ? String(q) : q;
  return (typeof text === "string" && text.trim()) || undefined;
}
