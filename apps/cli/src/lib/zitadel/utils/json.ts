import { ConfigError } from "@/lib/zitadel/errors";
import type { JsonArray, JsonObject, JsonValue } from "@/lib/zitadel/types";

/**
 * Whether a value from outside the library is JSON all the way down: a
 * string, a finite number, a boolean, `null`, or a list or plain object of
 * those.
 *
 * @remarks
 * The one deep check, for values that enter typed loosely: a file's parsed
 * text, a server's revision body, a provider's generated connection. Code
 * that already holds a {@link JsonValue} narrows with {@link isJsonObject}.
 *
 * @param value - Anything.
 * @returns Whether it is a JSON value.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  // An absent member, as `JsonObject` allows one.
  return Object.values(value).every((member) => {
    return member === undefined || isJsonValue(member);
  });
}

/**
 * A value from outside the library as a JSON object.
 *
 * @param value - Anything.
 * @param what - What the value is, for the message when it is not one.
 * @returns The same value, typed as a JSON object.
 * @throws {@link ConfigError} When it is not a JSON object.
 */
export function toJsonObject(value: unknown, what: string): JsonObject {
  if (!isJsonValue(value) || !isJsonObject(value)) {
    throw new ConfigError(`${what} is not a JSON object`);
  }
  return value;
}

/**
 * Whether a JSON value is an object: not a list, not `null`.
 *
 * @param value - A JSON value, or nothing.
 * @returns Whether it is an object.
 */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a JSON value is a list.
 *
 * @param value - A JSON value, or nothing.
 * @returns Whether it is a list.
 */
export function isJsonArray(value: JsonValue | undefined): value is JsonArray {
  return Array.isArray(value);
}

/**
 * The strings in a JSON list, in order, dropping anything else.
 *
 * @param value - A JSON value, or nothing.
 * @returns The strings, or none when it is not a list.
 */
export function stringsIn(value: JsonValue | undefined): readonly string[] {
  if (!isJsonArray(value)) {
    return [];
  }
  return value.filter((item): item is string => {
    return typeof item === "string";
  });
}

/**
 * The string at a key, or `undefined` when the key holds anything else.
 *
 * @param body - The object to read.
 * @param key - The key to read.
 * @returns The string at the key.
 */
export function stringAt(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
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

/**
 * The list at a key, or an empty one when the key holds anything else.
 *
 * @param body - The object to read.
 * @param key - The key to read.
 * @returns The list at the key, as the very list the object holds.
 */
export function listAt(body: JsonObject, key: string): JsonArray {
  const value = body[key];
  if (isJsonArray(value)) {
    return value;
  }
  return [];
}

/**
 * An object without one of its keys.
 *
 * @param body - The object.
 * @param key - The key to leave out.
 * @returns A new object with every other key, in the same order.
 */
export function withoutKey(body: JsonObject, key: string): JsonObject {
  return Object.fromEntries(
    Object.entries(body).filter((entry) => {
      return entry[0] !== key;
    }),
  );
}
