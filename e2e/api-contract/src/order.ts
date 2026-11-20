/** Orders by code point, so a regenerated baseline sorts the same on every machine. */
export function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
