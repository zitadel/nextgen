/**
 * Parse a JSON attribute a Liquid template passed through. Empty or malformed
 * input yields `undefined`: server data reaching a template must not throw.
 */
export function parseJsonAttribute(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
