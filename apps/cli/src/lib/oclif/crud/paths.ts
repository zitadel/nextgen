import type { FieldPaths } from "@/lib/oclif/columns";
import type { Schema } from "./types";
import { unwrap, type ZodLike } from "./zod";

/**
 * A record's fields, each with every schema that describes it. A field can
 * have more than one: each variant of the event union carries its own
 * `payload`, and keeping only one of them would refuse every other variant's
 * payload fields.
 */
type Fields = ReadonlyMap<string, readonly ZodLike[]>;

/** The fields records of these schemas can carry, gathered from all of them. */
const fieldsOf = (schemas: readonly (ZodLike | undefined)[]): Fields => {
  const fields = new Map<string, ZodLike[]>();
  const visit = (schema: ZodLike | undefined): void => {
    const type = unwrap(schema);
    if (type?.shape) {
      for (const [key, field] of Object.entries(type.shape)) {
        fields.set(key, [...(fields.get(key) ?? []), field]);
      }
      return;
    }
    // An intersection (a shared envelope `and` a per-variant payload, which is
    // how the event union is generated) contributes both halves.
    if (type?.def?.left || type?.def?.right) {
      visit(type.def.left);
      visit(type.def.right);
      return;
    }
    // A union of variants (the event union) contributes every variant's
    // fields: any of them can arrive, so any of them is a legal path.
    for (const option of type?.def?.options ?? []) {
      visit(option);
    }
  };
  for (const schema of schemas) {
    visit(schema);
  }
  return fields;
};

/** Walk a record schema into the paths a caller may name. */
export const fieldPaths = (schema: Schema | undefined, depth = 3): FieldPaths | undefined => {
  const fields = fieldsOf([schema as ZodLike]);
  if (fields.size === 0) {
    return undefined;
  }
  const known = new Set<string>();
  const open: string[] = [];
  const walk = (current: Fields, prefix: string, left: number): void => {
    for (const [key, schemas] of current) {
      const path = prefix ? `${prefix}.${key}` : key;
      known.add(path);
      if (schemas.some((field) => unwrap(field)?.def?.type === "record")) {
        open.push(path);
        continue;
      }
      const nested = left > 1 ? fieldsOf(schemas) : undefined;
      if (nested !== undefined && nested.size > 0) {
        walk(nested, path, left - 1);
      }
    }
  };
  walk(fields, "", depth);
  return { known, open };
};
