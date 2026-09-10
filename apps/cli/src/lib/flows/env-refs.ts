import { isObject } from "../json";

/**
 * Collects the environment variables a flows document depends on, sorted and
 * de-duplicated. Recognises two reference styles: inline `${VAR}` interpolations
 * inside string values, and keys ending in `_env` whose value names a single
 * variable. `apply`/`plan` use this to fail before contacting the platform when
 * a required variable is absent.
 */
export function flowEnvRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        const ref = match[1];
        if (ref) {
          refs.add(ref);
        }
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (key.endsWith("_env") && typeof child === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(child)) {
          refs.add(child);
        } else {
          visit(child);
        }
      }
    }
  };
  visit(value);
  return [...refs].sort();
}
