/**
 * The value a defaulted public property should hold: `fallback` when the
 * assigned value is `null`, `undefined` or `""`.
 *
 * Framework wrappers clear a prop in different ways: React and Solid assign
 * `undefined`, Vue writes `""` to a string property, and Angular or Svelte
 * remove the attribute, which Lit's String converter turns into `null`.
 * Lit never restores an initializer on its own, so without this a cleared
 * `heading` paints an empty title and a cleared `purpose` starts a flow the
 * server rejects. Routing every setter through here makes "unset" mean
 * "the default" no matter how the framework spells it.
 */
export function orDefault<T>(value: T | null | undefined | "", fallback: T): T {
  return value === undefined || value === null || value === "" ? fallback : value;
}
