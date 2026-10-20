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
    /** The value schema of a record. */
    valueType?: ZodLike;
    /** What a `default` fills in when the field is left out. */
    defaultValue?: unknown;
    /** The values of a literal. */
    values?: readonly unknown[];
    /** A number's format: `safeint` for an integer. */
    format?: string;
    /** Refinements; an integer written as `number().int()` carries a `number_format` one. */
    checks?: readonly { _zod?: { def?: { check?: string; format?: string } } }[];
  };
  shape?: Record<string, ZodLike>;
  /** The allowed values of an enum. */
  options?: readonly string[];
  description?: string;
  /** Whether a body may leave the value out, as Zod itself decides. */
  isOptional?: () => boolean;
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
export const unwrap = (
  schema: ZodLike | undefined,
  depth = MAX_WRAPPER_DEPTH,
): ZodLike | undefined =>
  schema?.def?.innerType && depth > 0 ? unwrap(schema.def.innerType, depth - 1) : schema;

/** The wrappers around a field, outermost first, the field's own type last. */
const layers = (schema: ZodLike | undefined): ZodLike[] => {
  const found: ZodLike[] = [];
  for (let current = schema; current && found.length <= MAX_WRAPPER_DEPTH; ) {
    found.push(current);
    current = current.def?.innerType;
  }
  return found;
};

/**
 * Whether a body may leave the field out: it is `optional`, or carries a
 * `default` the schema fills in. A `nullable` field is still required; it only
 * accepts `null` as its value.
 */
export const isOptionalField = (field: ZodLike | undefined): boolean =>
  typeof field?.isOptional === "function"
    ? field.isOptional()
    : layers(field).some((layer) => ["optional", "default"].includes(layer.def?.type ?? ""));

/** The value the schema fills in for a field left out, when it has one. */
export const defaultOf = (field: ZodLike | undefined): { value: unknown } | undefined => {
  const layer = layers(field).find((candidate) => candidate.def?.type === "default");
  return layer ? { value: layer.def?.defaultValue } : undefined;
};

/** Whether a number schema only takes integers. */
export const isInteger = (schema: ZodLike | undefined): boolean => {
  const type = unwrap(schema);
  return (
    (type?.def?.format ?? "").includes("int") ||
    (type?.def?.checks ?? []).some(
      (check) =>
        check._zod?.def?.check === "number_format" && (check._zod.def.format ?? "").includes("int"),
    )
  );
};

/**
 * The object a field holds, to walk into: a plain object, or the object of a
 * field that is either that object or `null` (a clearable one, such as a
 * project's `password_hash`). Anything else — a scalar, a record, a union of
 * several objects — has no fixed fields to walk.
 */
export const objectOf = (schema: ZodLike | undefined): ZodLike | undefined => {
  const type = unwrap(schema);
  if (type?.def?.type === "object" && type.shape) {
    return type;
  }
  if (type?.def?.type !== "union") {
    return undefined;
  }
  const members = (type.def.options ?? []).map((member) => unwrap(member));
  const objects = members.filter((member) => member?.def?.type === "object" && member.shape);
  const nulls = members.filter((member) => member?.def?.type === "null");
  return objects.length === 1 && objects.length + nulls.length === members.length
    ? objects[0]
    : undefined;
};

/** One field of an object schema, never a property inherited from `Object.prototype`. */
export const fieldOf = (schema: ZodLike | undefined, key: string): ZodLike | undefined => {
  const shape = objectOf(schema)?.shape;
  return shape && Object.hasOwn(shape, key) ? shape[key] : undefined;
};

/**
 * What a schema says about the value at one path into a document. `node` is
 * the schema at the path; `open` says the path runs through an open record (a
 * user's `attributes`), below which the API spec names no keys, so any key is
 * legal and `node` is whatever the record says of its values — often nothing.
 */
export type PathNode = Readonly<{ node: ZodLike | undefined; open: boolean }>;

/**
 * Follow a path into a document's schema. Returns `undefined` when the path
 * names a field the schema does not have, or runs on past a value that has no
 * fields of its own.
 */
export const nodeAt = (
  schema: ZodLike | undefined,
  path: readonly string[],
): PathNode | undefined => {
  let node = schema;
  let open = false;
  for (const segment of path) {
    const type = unwrap(node);
    if (objectOf(type)) {
      const field = fieldOf(type, segment);
      if (!field) {
        return undefined;
      }
      node = field;
    } else if (type?.def?.type === "record") {
      node = type.def.valueType;
      open = true;
    } else if (open && (!type || type.def?.type === "any" || type.def?.type === "unknown")) {
      // Below an open record whose values the spec leaves untyped: any key.
      node = undefined;
    } else {
      return undefined;
    }
  }
  return { node, open };
};
