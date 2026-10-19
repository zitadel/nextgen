/** A raw search param as a string, or `undefined` when it is absent or not one. */
export function stringParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
