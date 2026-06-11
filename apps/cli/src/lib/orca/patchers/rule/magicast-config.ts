import { ZitadelError } from "../../../errors";

/**
 * Generic magicast helpers shared by the config-editing patchers (Vite, Nuxt).
 * They navigate a module's default export — they carry no framework knowledge
 * beyond "find the config object literal" and "is this import present".
 */

/**
 * Reaches the object literal of a module's default export — the argument of
 * `export default <call>({...})` (e.g. `defineConfig`/`defineNuxtConfig`) or a
 * bare `export default {...}`. Throws `E_VALIDATION` for shapes magicast cannot
 * safely edit (function-form, configs built elsewhere) so the caller can fall
 * back to manual steps.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveDefaultExportObject(mod: any, filename: string): any {
  const def = mod.exports?.default;
  const unreachable = () =>
    new ZitadelError("E_VALIDATION", `Could not locate the config object in ${filename}`, {
      hint: `Add the Zitadel configuration to ${filename} manually (see the SDK README).`,
    });
  if (!def) {
    throw unreachable();
  }
  if (def.$type === "function-call") {
    const arg = def.$args?.[0];
    if (!arg || arg.$type !== "object") {
      throw unreachable();
    }
    return arg;
  }
  if (def.$type === "object") {
    return def;
  }
  throw unreachable();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importIsPresent(mod: any, local: string): boolean {
  try {
    const items: ReadonlyArray<{ local?: string }> = mod.imports?.$items ?? [];
    return items.some((item) => item.local === local);
  } catch {
    return false;
  }
}

/**
 * Appends `item` to a string array at `parent[key]`, creating the array when
 * absent and skipping it when already present. Reads the proxified array by
 * index so primitive elements compare as plain values.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ensureArrayItem(parent: any, key: string, item: string): void {
  if (parent[key] === undefined) {
    parent[key] = [item];
    return;
  }
  const arr = parent[key];
  // The existing value is something other than an array literal (e.g. an
  // identifier or spread), which magicast cannot safely append to. Surface a
  // clean E_VALIDATION instead of letting `arr.push` throw a raw TypeError.
  if (typeof arr?.push !== "function" || typeof arr?.length !== "number") {
    throw new ZitadelError("E_VALIDATION", `Could not add "${item}" to "${key}"`, {
      hint: `Add "${item}" to "${key}" in your config manually.`,
    });
  }
  const present = Array.from({ length: arr.length as number }, (_unused, i) => arr[i]).includes(item);
  if (!present) {
    arr.push(item);
  }
}
