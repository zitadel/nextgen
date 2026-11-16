import { z } from "zod";

import { ConfigError } from "@/lib/zitadel/errors";
import type { JsonArray, JsonObject, JsonValue } from "@/lib/zitadel/types";

/**
 * Zod's `z.json()`, with an object's members allowed to be absent.
 *
 * @remarks
 * `z.json()` refuses an object member that is `undefined`, which
 * {@link JsonObject} allows, and its `z.record` refuses any object that is
 * not plain. This is the same lazy union with `z.object({}).catchall` in
 * place of the record, so a member may be absent and any object counts by
 * its own enumerable string keys. `z.number()` already refuses `NaN` and the
 * infinities.
 */
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => {
  return z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.object({}).catchall(jsonValueSchema.optional()),
  ]);
});

/**
 * Whether a value from outside the library is JSON all the way down: a
 * string, a finite number, a boolean, `null`, or a list or object of those.
 *
 * @remarks
 * The one deep check, for data entering the program typed loosely: a file's
 * parsed text, a server's revision body, a provider's generated connection.
 * Code that already holds a {@link JsonValue} narrows with
 * {@link isJsonObject}.
 *
 * @param value - Anything.
 * @returns Whether it is a JSON value.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  return jsonValueSchema.safeParse(value).success;
}

/**
 * A value from outside the library as a JSON object.
 *
 * @remarks
 * For data entering the program: a parsed file, a server's answer, a
 * shipped default. The value is checked, not copied.
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
 * @remarks
 * For raw bodies and data entering the program, where no contract has typed
 * the value yet.
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
 * @remarks
 * For raw bodies and data entering the program, where no contract has typed
 * the value yet.
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
 * @remarks
 * For raw bodies only: a part the contract does not keep, such as a user
 * schema's `type` and `required`, or a flow's steps while they are edited.
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
 * @remarks
 * For raw bodies only: a file the contract may have refused, so it has no
 * typed value to read.
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
 * @remarks
 * For raw bodies only: a read or an edit of the body as written. Code that
 * holds a contract's typed value reads that instead.
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
 * @remarks
 * For raw bodies only: a read or an edit of the body as written. Code that
 * holds a contract's typed value reads that instead.
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
 * @remarks
 * For raw bodies only: an edit of the body as written, such as dropping the
 * editor-only `$schema` pointer.
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
