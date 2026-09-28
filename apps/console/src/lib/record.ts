/**
 * Reads a string field from an open API object. Several resources (users,
 * schemas) are typed as `{ [key: string]: unknown }` because their shape is
 * schema-defined, so the console reads known fields defensively.
 */
export function field(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads a schema-defined attribute for display.
 *
 * `field` is deliberately string-only: it reads server-owned keys like `id` and
 * `schema`, where a non-string means the record is not what was expected. A
 * *schema* attribute is different — `schemaFields` surfaces `number` and
 * `integer` properties, and a schema may define a boolean, so reading those
 * through `field` renders a real value as blank.
 *
 * Only primitives are stringified. An object or array has no one-line rendering,
 * and `JSON.stringify` in a table cell or a form field is noise.
 */
export function displayValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
