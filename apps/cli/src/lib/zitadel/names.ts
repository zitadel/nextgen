/**
 * Names that must not be mixed up.
 *
 * @remarks
 * A claim mapping reads a claim into a property, and a step names a step: each
 * is its own type, so passing one where another belongs does not compile. Each
 * is a `Tagged` string (type-fest): still the string it wraps at run time, and
 * made only by its constructor here, the one place its cast lives.
 */
import type { Tagged } from "type-fest";

/**
 * A top-level property of a user schema, as a claim mapping names it.
 */
export type PropertyName = Tagged<string, "PropertyName">;

/**
 * A dotted path into a user's attributes, such as `address.street`.
 */
export type PropertyPath = Tagged<string, "PropertyPath">;

/**
 * A claim a provider returns, as a claim mapping reads it.
 */
export type ClaimName = Tagged<string, "ClaimName">;

/**
 * A step of a login flow.
 */
export type StepName = Tagged<string, "StepName">;

/**
 * A user schema's `objectType`: the handle a release pins it by, and the name
 * a flow's `user_schema` may use.
 */
export type ObjectType = Tagged<string, "ObjectType">;

/**
 * A login flow's `name`: the handle a release pins it by.
 */
export type FlowName = Tagged<string, "FlowName">;

/**
 * A flow's `user_schema` as written: an object type, a schema id or a `$id` URL.
 */
export type SchemaReference = Tagged<string, "SchemaReference">;

/**
 * An environment variable a configuration file reads through an `*_env` key.
 */
export type EnvironmentVariable = Tagged<string, "EnvironmentVariable">;

/**
 * Brand a property name read from a file.
 *
 * @remarks
 * A name in a file is whatever the author wrote, and the rules judge it, so
 * nothing is refused here; the same holds for every constructor below.
 *
 * @param value - The name as written.
 * @returns The same text, typed as a property name.
 */
export function propertyName(value: string): PropertyName {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as PropertyName;
}

/**
 * Brand a dotted attribute path.
 *
 * @param value - The path as written.
 * @returns The same text, typed as a property path.
 */
export function propertyPath(value: string): PropertyPath {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as PropertyPath;
}

/**
 * Brand a claim name read from a file.
 *
 * @param value - The claim as written.
 * @returns The same text, typed as a claim name.
 */
export function claimName(value: string): ClaimName {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as ClaimName;
}

/**
 * Brand a step name read from a file.
 *
 * @param value - The step name as written.
 * @returns The same text, typed as a step name.
 */
export function stepName(value: string): StepName {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as StepName;
}

/**
 * Brand a schema's object type read from a file or a server.
 *
 * @param value - The object type as written.
 * @returns The same text, typed as an object type.
 */
export function objectType(value: string): ObjectType {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as ObjectType;
}

/**
 * Brand a flow's name read from a file or a server.
 *
 * @param value - The name as written.
 * @returns The same text, typed as a flow name.
 */
export function flowName(value: string): FlowName {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as FlowName;
}

/**
 * Brand a flow's `user_schema` read from a file.
 *
 * @param value - The reference as written.
 * @returns The same text, typed as a schema reference.
 */
export function schemaReference(value: string): SchemaReference {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as SchemaReference;
}

/**
 * Brand an environment variable's name read from a file.
 *
 * @param value - The name as written.
 * @returns The same text, typed as an environment variable.
 */
export function environmentVariable(value: string): EnvironmentVariable {
  // A brand exists only for the type checker, so a cast is the only way to make one.
  return value as EnvironmentVariable;
}
