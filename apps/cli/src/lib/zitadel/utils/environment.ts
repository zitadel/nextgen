import { type EnvironmentVariable, environmentVariable } from "@/lib/zitadel/names";
import type { JsonValue } from "@/lib/zitadel/types";
import { isJsonArray, isJsonObject } from "@/lib/zitadel/utils/json";

/**
 * An inline `${VAR}` interpolation, capturing the variable's name.
 */
const INTERPOLATION = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * A value that is exactly one variable's name, as an `_env` key holds it.
 */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Every variable one value names, in document order, with repeats.
 *
 * @param value - A JSON value, or an absent member.
 * @returns The names it holds.
 */
function namesIn(value: JsonValue | undefined): readonly string[] {
  if (typeof value === "string") {
    return [...value.matchAll(INTERPOLATION)].flatMap((match) => {
      return match.slice(1, 2);
    });
  }
  if (isJsonArray(value)) {
    return value.flatMap(namesIn);
  }
  if (!isJsonObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap((entry) => {
    const key = entry[0];
    const child = entry[1];
    if (key.endsWith("_env") && typeof child === "string" && VARIABLE_NAME.test(child)) {
      return [child];
    }
    return namesIn(child);
  });
}

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
export function environmentReferences(value: JsonValue): readonly EnvironmentVariable[] {
  // The set makes a fresh list, so sorting it changes nothing anyone else holds.
  const unique = [...new Set(namesIn(value))].sort();
  return unique.map(environmentVariable);
}
