/**
 * Reads a string field from an open API object. Several resources (users,
 * schemas) are typed as `{ [key: string]: unknown }` because their shape is
 * schema-defined, so the console reads known fields defensively.
 */
export function field(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
