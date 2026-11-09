/**
 * Names that must not be mixed up. A claim mapping reads a claim into a
 * property, and a step names a step: each is its own type, so passing one where
 * another belongs does not compile.
 */

declare const brand: unique symbol;

/** A string that only its own constructor makes. */
type Name<Kind extends string> = string & { readonly [brand]: Kind };

/** A top-level property of a user schema, as a claim mapping names it. */
export type PropertyName = Name<"PropertyName">;

/** A claim a provider returns, as a claim mapping reads it. */
export type ClaimName = Name<"ClaimName">;

/** A step of a login flow. */
export type StepName = Name<"StepName">;

/**
 * Brand a name read from a file. The one place each brand is made: a name in a
 * file is whatever the author wrote, and the rules judge it, so nothing is
 * refused here.
 *
 * @param value - The name as written.
 * @returns The same text, typed as a property name.
 */
export function propertyName(value: string): PropertyName {
  return value as PropertyName;
}

/**
 * Brand a claim name read from a file.
 *
 * @param value - The claim as written.
 * @returns The same text, typed as a claim name.
 */
export function claimName(value: string): ClaimName {
  return value as ClaimName;
}

/**
 * Brand a step name read from a file.
 *
 * @param value - The step name as written.
 * @returns The same text, typed as a step name.
 */
export function stepName(value: string): StepName {
  return value as StepName;
}
