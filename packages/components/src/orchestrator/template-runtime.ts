/**
 * The runtime a template compiled at build time renders with
 * (`import render from "./file.liquid?compiled"`, see `vite-liquid-plugin.ts`).
 *
 * Each helper reproduces the LiquidJS 10 rule the engine applies under the
 * options `createLiquidEngine` sets (`jsTruthy`, `ownPropertyOnly`,
 * `outputEscape: "escape"`), so a compiled template renders the same bytes as
 * the engine without shipping it. Only what the compiler emits is here; the
 * compiler refuses a template that needs anything else.
 */

/** A filter as the template's dialect registers it. */
export type TemplateFilter = (value: unknown, ...args: unknown[]) => unknown;

/** A custom tag's renderer, called once per occurrence. */
export type TemplateTag = () => unknown;

/** The variables one render reads, and the ones `{% assign %}` writes. */
export type RenderScope = {
  /** The render context the caller passes in. */
  env: Record<string, unknown>;
  /** What `{% assign %}` wrote during this render. */
  assigns: Record<string, unknown>;
};

/** A template compiled to a function of its context, filters and tags. */
export type CompiledTemplate = (
  env: Record<string, unknown>,
  filters: Readonly<Record<string, TemplateFilter>>,
  tags: Readonly<Record<string, TemplateTag>>,
) => string;

/**
 * A literal that compares by its own rule: `nil`, `empty` or `blank`.
 */
abstract class LiteralDrop {
  /**
   * Whether a value equals this literal.
   *
   * @param value - The other operand.
   * @returns `true` when Liquid treats the two as equal.
   */
  abstract equals(value: unknown): boolean;

  /**
   * The plain value the literal stands for.
   *
   * @returns The value Liquid reads when it uses the literal as a value.
   */
  abstract valueOf(): unknown;
}

/** `nil`: equal to `null` and `undefined`. */
class NullDrop extends LiteralDrop {
  /**
   * @param value - The other operand.
   * @returns `true` when `value` is nil.
   */
  equals(value: unknown): boolean {
    return isNil(toValue(value));
  }

  /**
   * @returns `null`.
   */
  valueOf(): unknown {
    return null;
  }
}

/** `empty`: equal to an empty string, array or object. */
class EmptyDrop extends LiteralDrop {
  /**
   * @param value - The other operand.
   * @returns `true` when `value` has no length or no keys.
   */
  equals(value: unknown): boolean {
    if (value instanceof EmptyDrop) {
      return false;
    }
    const plain = toValue(value);
    if (typeof plain === "string" || Array.isArray(plain)) {
      return plain.length === 0;
    }
    if (isObject(plain)) {
      return Object.keys(plain).length === 0;
    }
    return false;
  }

  /**
   * @returns The empty string.
   */
  valueOf(): unknown {
    return "";
  }
}

/** `blank`: `empty`, plus `false`, nil and whitespace-only strings. */
class BlankDrop extends EmptyDrop {
  /**
   * @param value - The other operand.
   * @returns `true` when `value` is blank.
   */
  override equals(value: unknown): boolean {
    if (value === false) {
      return true;
    }
    if (isNil(toValue(value))) {
      return true;
    }
    if (typeof value === "string") {
      return /^\s*$/.test(value);
    }
    return super.equals(value);
  }
}

const LITERALS: Readonly<Record<string, unknown>> = {
  true: true,
  false: false,
  nil: new NullDrop(),
  null: new NullDrop(),
  empty: new EmptyDrop(),
  blank: new BlankDrop(),
};

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&#34;",
  "'": "&#39;",
};

/**
 * Whether a value is `null` or `undefined`.
 *
 * @param value - Any value.
 * @returns `true` for `null` and `undefined`.
 */
function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Whether a value is a non-null object or a function.
 *
 * @param value - Any value.
 * @returns `true` for objects and functions.
 */
function isObject(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

/**
 * The value a literal stands for; anything else as it is.
 *
 * @param value - Any value.
 * @returns The literal's plain value, or `value`.
 */
export function toValue(value: unknown): unknown {
  return value instanceof LiteralDrop ? value.valueOf() : value;
}

/**
 * A Liquid literal by its name.
 *
 * @param name - `true`, `false`, `nil`, `null`, `empty` or `blank`.
 * @returns The literal's value.
 */
export function literal(name: string): unknown {
  return LITERALS[name];
}

/**
 * A value as Liquid writes it to the output.
 *
 * @param value - Any value.
 * @returns Strings as they are, nil as `""`, arrays joined, the rest `String`.
 */
export function stringify(value: unknown): string {
  const plain = toValue(value);
  if (typeof plain === "string") {
    return plain;
  }
  if (isNil(plain)) {
    return "";
  }
  if (Array.isArray(plain)) {
    return plain.map((item) => stringify(item)).join("");
  }
  return String(plain);
}

/**
 * The `escape` filter, which `outputEscape` applies to every `{{ }}`.
 *
 * @param value - Any value.
 * @returns The stringified value with `& < > " '` escaped.
 */
export function escapeOutput(value: unknown): string {
  return stringify(value).replace(/[&<>"']/g, (match) => ESCAPES[match] ?? match);
}

/**
 * Liquid truthiness under `jsTruthy`.
 *
 * @param value - Any value.
 * @returns JavaScript truthiness of the plain value.
 */
export function truthy(value: unknown): boolean {
  return Boolean(toValue(value));
}

/**
 * The `==` operator.
 *
 * @param left - Left operand.
 * @param right - Right operand.
 * @returns `true` when Liquid treats the operands as equal.
 */
export function equals(left: unknown, right: unknown): boolean {
  if (left instanceof LiteralDrop) {
    return left.equals(right);
  }
  if (right instanceof LiteralDrop) {
    return right.equals(left);
  }
  const lhs = toValue(left);
  const rhs = toValue(right);
  if (Array.isArray(lhs)) {
    return (
      Array.isArray(rhs) &&
      lhs.length === rhs.length &&
      lhs.every((item, index) => equals(item, rhs[index]))
    );
  }
  return lhs === rhs;
}

/**
 * The `and` operator; both operands are evaluated, as in the engine.
 *
 * @param left - Left operand.
 * @param right - Right operand.
 * @returns Whether both are truthy.
 */
export function and(left: unknown, right: unknown): boolean {
  return truthy(left) && truthy(right);
}

/**
 * The `or` operator; both operands are evaluated, as in the engine.
 *
 * @param left - Left operand.
 * @param right - Right operand.
 * @returns Whether either is truthy.
 */
export function or(left: unknown, right: unknown): boolean {
  return truthy(left) || truthy(right);
}

/**
 * Reads one property the way the engine does under `ownPropertyOnly`,
 * including the `size`, `first` and `last` shorthands.
 *
 * @param target - The object, array or string read from.
 * @param key - The property name or array index.
 * @returns The property's value, or `undefined`.
 */
export function readProperty(target: unknown, key: unknown): unknown {
  const plainKey = toValue(key);
  if (isNil(target)) {
    return target;
  }
  if (Array.isArray(target) && typeof plainKey === "number") {
    return readArrayElement(target, plainKey);
  }
  const value = readOwn(target, plainKey);
  if (typeof value === "function") {
    return value.call(target);
  }
  if (plainKey === "size") {
    return readSize(target);
  }
  if (plainKey === "first") {
    return Array.isArray(target) ? readArrayElement(target, 0) : readOwn(target, "first");
  }
  if (plainKey === "last") {
    return Array.isArray(target) ? readArrayElement(target, -1) : readOwn(target, "last");
  }
  return value;
}

/**
 * Reads a dotted path from a scope.
 *
 * @param scope - The scope the first segment is read from.
 * @param path - The segments, first one included.
 * @returns The value at the end of the path.
 */
export function get(scope: unknown, path: readonly unknown[]): unknown {
  let value = scope;
  for (const segment of path) {
    value = readProperty(value, segment);
  }
  return value;
}

/**
 * The scope a root variable resolves in: what `{% assign %}` wrote, then the
 * render context, else an empty global scope.
 *
 * @param scope - The current render's variables.
 * @param name - The root variable.
 * @returns The object to read `name` from.
 */
export function scopeOf(scope: RenderScope, name: string): object {
  if (name in scope.assigns) {
    return scope.assigns;
  }
  if (name in scope.env) {
    return scope.env;
  }
  return {};
}

/**
 * What a `{% for %}` loop iterates.
 *
 * @param value - The collection.
 * @returns Arrays as they are, a non-empty string as one item, an object's entries.
 */
export function toEnumerable(value: unknown): unknown[] {
  const plain = toValue(value);
  if (Array.isArray(plain)) {
    return plain;
  }
  if (typeof plain === "string" && plain.length > 0) {
    return [plain];
  }
  if (isObject(plain) && Symbol.iterator in plain) {
    return Array.from(plain as Iterable<unknown>);
  }
  if (isObject(plain)) {
    return Object.entries(plain);
  }
  return [];
}

/**
 * The `where` filter.
 *
 * @param collection - The items to filter.
 * @param property - The dotted property each item is tested on.
 * @param expected - The value it must equal; when omitted, it must be truthy.
 * @returns The matching items.
 */
export function where(collection: unknown, property: unknown, expected?: unknown): unknown[] {
  const items = toArray(collection);
  const path = stringify(property).split(".");
  const root = path[0] ?? "";
  return items.filter((item) => {
    const scope = root in (item as object) ? item : {};
    const value = get(scope, path);
    if (expected === undefined) {
      return truthy(value);
    }
    return equals(value, expected);
  });
}

/**
 * The `first` filter.
 *
 * @param value - An array or string.
 * @returns Its first element, or `""` when it has no length.
 */
export function first(value: unknown): unknown {
  const plain = toValue(value) as { length?: unknown } | null | undefined;
  if (plain && typeof plain.length === "number") {
    return readArrayElement(plain as ArrayLike<unknown>, 0);
  }
  return "";
}

/**
 * The `json` filter.
 *
 * @param value - Any value.
 * @param space - Indentation, as `JSON.stringify` takes it.
 * @returns The JSON text.
 */
export function json(value: unknown, space: unknown = 0): string {
  return JSON.stringify(value, null, space as number);
}

/**
 * Applies a dialect filter; an unregistered one passes its input through, as
 * the engine does without `strictFilters`.
 *
 * @param filters - The dialect's filters.
 * @param name - The filter's name.
 * @param value - The piped value.
 * @param args - The filter's arguments.
 * @returns The filter's result.
 */
export function filter(
  filters: Readonly<Record<string, TemplateFilter>>,
  name: string,
  value: unknown,
  args: readonly unknown[],
): unknown {
  const handler = filters[name];
  if (handler === undefined) {
    return value;
  }
  return handler(value, ...args);
}

/**
 * An array element, counting a negative index from the end.
 *
 * @param array - The array or string.
 * @param index - The index.
 * @returns The own element at that index, or `undefined`.
 */
function readArrayElement(array: ArrayLike<unknown>, index: number): unknown {
  const at = index < 0 ? array.length + index : index;
  if (!Object.hasOwn(Object(array), at)) {
    return undefined;
  }
  return array[at];
}

/**
 * An own property; inherited ones read as `undefined`.
 *
 * @param target - Any non-nil value.
 * @param key - The property name.
 * @returns The property's value, or `undefined`.
 */
function readOwn(target: unknown, key: unknown): unknown {
  const object = Object(target) as Record<PropertyKey, unknown>;
  if (!Object.hasOwn(object, key as PropertyKey)) {
    return undefined;
  }
  return object[key as PropertyKey];
}

/**
 * The `size` shorthand.
 *
 * @param target - Any non-nil value.
 * @returns Its own `size`, its length, or its key count.
 */
function readSize(target: unknown): unknown {
  const object = Object(target) as Record<string, unknown>;
  if (Object.hasOwn(object, "size") || object.size !== undefined) {
    return object.size;
  }
  if (Array.isArray(target) || typeof target === "string") {
    return target.length;
  }
  if (typeof target === "object") {
    return Object.keys(target as object).length;
  }
  return undefined;
}

/**
 * The array a filter iterates.
 *
 * @param value - Any value.
 * @returns Nil as `[]`, an array as it is, anything else wrapped.
 */
function toArray(value: unknown): unknown[] {
  const plain = toValue(value);
  if (isNil(plain)) {
    return [];
  }
  if (Array.isArray(plain)) {
    return plain;
  }
  return [plain];
}

/**
 * The ordering operators (`>`, `<`, `>=`, `<=`). A `nil`, `empty` or `blank`
 * operand orders against nothing, as in the engine.
 *
 * @param operator - The operator.
 * @param left - Left operand.
 * @param right - Right operand.
 * @returns The comparison's result.
 */
export function compare(operator: ">" | "<" | ">=" | "<=", left: unknown, right: unknown): boolean {
  if (left instanceof LiteralDrop || right instanceof LiteralDrop) {
    return false;
  }
  const lhs = toValue(left) as number;
  const rhs = toValue(right) as number;
  if (operator === ">") {
    return lhs > rhs;
  }
  if (operator === "<") {
    return lhs < rhs;
  }
  if (operator === ">=") {
    return lhs >= rhs;
  }
  return lhs <= rhs;
}
