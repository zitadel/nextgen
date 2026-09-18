/**
 * The slice of a generated Zod schema's internals the command factory reads.
 *
 * The generated schemas are values, not types, and the factory needs to walk
 * them to learn a request's fields and a response's shape. Zod's own internal
 * types are not part of its public API, so this is the minimum structural
 * description of what is actually touched — declared once because both the
 * field reader and the path walker need it, and a second copy would drift.
 */
export type ZodLike = {
  def?: {
    type?: string;
    /** The wrapped schema of `optional`, `default`, `nullable`, … */
    innerType?: ZodLike;
    /** The element schema of an array. */
    element?: ZodLike;
    /** The members of a union. */
    options?: readonly ZodLike[];
    /** The halves of an intersection. */
    left?: ZodLike;
    right?: ZodLike;
  };
  shape?: Record<string, ZodLike>;
  /** The allowed values of an enum. */
  options?: readonly string[];
  description?: string;
};

/**
 * Depth limit for peeling wrappers. A generated schema nests a handful at
 * most (`optional` around `default` around `nullable`); the limit exists so a
 * malformed or self-referential schema cannot spin rather than because a real
 * one comes close to it.
 */
const MAX_WRAPPER_DEPTH = 10;

/**
 * Peel the wrappers a generated schema puts around a field, so the caller sees
 * the type that decides how the field is rendered rather than the `optional`
 * that happens to enclose it.
 */
export const unwrap = (schema: ZodLike | undefined, depth = MAX_WRAPPER_DEPTH): ZodLike | undefined =>
  schema?.def?.innerType && depth > 0 ? unwrap(schema.def.innerType, depth - 1) : schema;
