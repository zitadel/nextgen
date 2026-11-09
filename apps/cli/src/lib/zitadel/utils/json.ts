import type { JsonObject } from "@/lib/zitadel/types";

/**
 * Whether a value is a JSON object: not an array, not `null`.
 *
 * @param value - Any parsed JSON value.
 * @returns Whether it is an object.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The strings in a JSON list, in order, dropping anything else.
 *
 * @param value - Any parsed JSON value.
 * @returns The strings, or none when it is not a list.
 */
export function stringsIn(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => {
    return typeof item === "string";
  });
}

/**
 * The object at a key, or an empty one when the key holds anything else.
 *
 * @param body - The object to read.
 * @param key - The key to read.
 * @returns The object at the key.
 */
export function objectAt(body: JsonObject, key: string): JsonObject {
  const value = body[key];
  if (isJsonObject(value)) {
    return value;
  }
  return {};
}
