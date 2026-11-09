import { isJsonObject } from "@/lib/zitadel/utils/json";

/**
 * An inline `${VAR}` interpolation, capturing the variable's name.
 */
const INTERPOLATION = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * A value that is exactly one variable's name, as an `_env` key holds it.
 */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The environment variables a document depends on, sorted and de-duplicated.
 *
 * @remarks
 * Two spellings count: inline `${VAR}` interpolations inside string values,
 * and keys ending in `_env` whose value names a single variable.
 *
 * @param value - A document.
 * @returns The variable names.
 */
export function environmentReferences(value: unknown): string[] {
  if (typeof value === "string") {
    const found = [...value.matchAll(INTERPOLATION)].flatMap((match) => {
      return match.slice(1, 2);
    });
    return [...new Set(found)].sort();
  }
  if (Array.isArray(value)) {
    const found = value.flatMap((item) => {
      return environmentReferences(item);
    });
    return [...new Set(found)].sort();
  }
  if (isJsonObject(value)) {
    const found = Object.entries(value).flatMap(([key, child]) => {
      if (key.endsWith("_env") && typeof child === "string" && VARIABLE_NAME.test(child)) {
        return [child];
      }
      return environmentReferences(child);
    });
    return [...new Set(found)].sort();
  }
  return [];
}
