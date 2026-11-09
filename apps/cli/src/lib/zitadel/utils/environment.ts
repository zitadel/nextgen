import { isJsonObject } from "@/lib/zitadel/utils/json";

/**
 * The environment variables a document depends on, sorted and de-duplicated:
 * inline `${VAR}` interpolations inside string values, and keys ending in
 * `_env` whose value names a single variable.
 *
 * @param value - A document.
 * @returns The variable names.
 */
export function environmentReferences(value: unknown): string[] {
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
    } else if (isJsonObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (
          key.endsWith("_env") &&
          typeof child === "string" &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(child)
        ) {
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
