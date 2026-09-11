import { isObject } from "../../json";
import type { Schema } from "./types";

/**
 * The dot-paths a record can carry, read from the generated response schema
 * rather than from whatever a given page happened to return. Sampling the
 * response would make `--fields` valid or invalid depending on how many records
 * came back — the same arguments failing on a full page and passing on an empty
 * one — so the shape decides instead.
 *
 * An open record (a user's `attributes`, whose keys come from the project's
 * user schema and not from the API spec) cannot be enumerated, so it is
 * reported as a prefix: anything beneath it is accepted.
 */
export type FieldPaths = Readonly<{
  /** Exact paths, such as `id` or `metadata.status`. */
  known: ReadonlySet<string>;
  /** Prefixes below which any path is legal, such as `attributes`. */
  open: readonly string[];
}>;

type ZodLike = {
  def?: {
    type?: string;
    innerType?: ZodLike;
    element?: ZodLike;
    options?: ZodLike[];
    left?: ZodLike;
    right?: ZodLike;
  };
  shape?: Record<string, ZodLike>;
};

/** Peel the wrappers a generated schema puts around a field. */
const unwrap = (schema: ZodLike | undefined): ZodLike | undefined => {
  let type = schema;
  let guard = 0;
  while (type?.def?.innerType && guard < 10) {
    type = type.def.innerType;
    guard += 1;
  }
  return type;
};

const shapeOf = (schema: ZodLike | undefined): Record<string, ZodLike> | undefined => {
  const type = unwrap(schema);
  if (type?.shape) {
    return type.shape;
  }
  // An intersection (a shared envelope `and` a per-variant payload, which is how
  // the event union is generated) contributes both halves.
  if (type?.def?.left || type?.def?.right) {
    const merged = { ...(shapeOf(type.def?.left) ?? {}), ...(shapeOf(type.def?.right) ?? {}) };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }
  // A union of variants (the event union) contributes every variant's fields:
  // any of them can arrive, so any of them is a legal path.
  const options = type?.def?.options;
  if (!options) {
    return undefined;
  }
  const merged: Record<string, ZodLike> = {};
  for (const option of options) {
    Object.assign(merged, shapeOf(option) ?? {});
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
};

/** The element schema of a list response's item array, given the array's key. */
export const itemSchemaOf = (response: Schema | undefined, key: string): Schema | undefined => {
  const array = unwrap(shapeOf(response as ZodLike)?.[key]);
  return (unwrap(array?.def?.element) as Schema | undefined) ?? undefined;
};

/** Walk a record schema into the paths a caller may name. */
export const fieldPaths = (schema: Schema | undefined, depth = 3): FieldPaths | undefined => {
  const shape = shapeOf(schema as ZodLike);
  if (!shape) {
    return undefined;
  }
  const known = new Set<string>();
  const open: string[] = [];
  const walk = (current: Record<string, ZodLike>, prefix: string, left: number): void => {
    for (const [key, field] of Object.entries(current)) {
      const path = prefix ? `${prefix}.${key}` : key;
      known.add(path);
      const type = unwrap(field);
      if (type?.def?.type === "record") {
        open.push(path);
        continue;
      }
      const nested = left > 1 ? shapeOf(type) : undefined;
      if (nested) {
        walk(nested, path, left - 1);
      }
    }
  };
  walk(shape, "", depth);
  return { known, open };
};

/** Whether a path is legal for records of this shape. */
export const allows = (paths: FieldPaths, path: string): boolean =>
  paths.known.has(path) || paths.open.some((prefix) => path.startsWith(`${prefix}.`));

/** The paths worth showing a caller who named one that does not exist. */
export const suggestable = (paths: FieldPaths): readonly string[] =>
  [...paths.known, ...paths.open.map((prefix) => `${prefix}.<key>`)].sort();

/** Fallback when no schema is available: the paths these records actually carry. */
export const observedPaths = (items: readonly unknown[]): FieldPaths => {
  const known = new Set<string>();
  for (const item of items) {
    if (!isObject(item)) {
      continue;
    }
    for (const [key, value] of Object.entries(item)) {
      known.add(key);
      if (isObject(value)) {
        for (const nested of Object.keys(value)) {
          known.add(`${key}.${nested}`);
        }
      }
    }
  }
  return { known, open: [] };
};
