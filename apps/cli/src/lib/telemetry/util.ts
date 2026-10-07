import type { Properties } from "mixpanel";

/**
 * Return a new bag with empty values stripped, per Mixpanel's "omit, never send
 * null/''" rule. Pure — the input is never mutated.
 */
export function compact(properties: Properties): Properties {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}
