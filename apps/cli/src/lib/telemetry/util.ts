import type { Properties } from "mixpanel";

/**
 * Return a new bag with empty values stripped, per Mixpanel's "omit, never send
 * null/''" rule. Pure — the input is never mutated.
 */
export function compact(properties: Properties): Properties {
  const out: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    out[key] = value;
  }
  return out;
}
