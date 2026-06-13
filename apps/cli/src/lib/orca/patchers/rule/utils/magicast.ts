import { parseModule } from "magicast";

import { ZitadelError } from "../../../../errors";

/**
 * Generic magicast helpers shared by the config-editing patchers (Vite, Nuxt).
 * They navigate a module's default export — they carry no framework knowledge
 * beyond "find the config object literal" and "is this import present".
 */

/**
 * Parses a config file with magicast, throwing a clean `E_VALIDATION` (instead
 * of a raw parse error) when the source is missing or unparseable. `filename` is
 * only used in the error message, so each patcher can name its own config file.
 */
export function parseConfigModule(
  source: string | undefined,
  filename: string,
): ReturnType<typeof parseModule> {
  if (source === undefined) {
    throw new ZitadelError("E_VALIDATION", `Cannot edit ${filename}: file not found`, {
      hint: `Run setup from a project that has ${filename}.`,
    });
  }
  // A CommonJS config (e.g. a `*.cjs` file or a `*.js` with `module.exports`)
  // can't evaluate the ESM `import`/`import.meta.url` these edits inject, so
  // reject it with a clear message instead of producing a broken config.
  if (/\bmodule\.exports\b/.test(source)) {
    throw new ZitadelError("E_VALIDATION", `${filename} is a CommonJS module, which can't be edited`, {
      hint: `The Zitadel edits use ESM imports. Convert the config to ESM (a .ts/.mts file, or set "type": "module"), or add the Zitadel block manually.`,
    });
  }
  try {
    return parseModule(source);
  } catch (error) {
    throw new ZitadelError("E_VALIDATION", `Could not parse ${filename}`, {
      hint: `Ensure ${filename} is valid, or apply the Zitadel changes manually.`,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
}

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
 * index so primitive elements compare as plain values. Returns `true` when it
 * actually added the item, so callers can tell whether the edit changed
 * anything (and skip rewriting an already-complete config).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ensureArrayItem(parent: any, key: string, item: string): boolean {
  if (parent[key] === undefined) {
    parent[key] = [item];
    return true;
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
  const present = Array.from({ length: arr.length as number }, (_unused, i) => arr[i]).includes(
    item,
  );
  if (!present) {
    arr.push(item);
    return true;
  }
  return false;
}

/**
 * Returns the object literal at `parent[key]`, creating an empty one when
 * absent, so callers can safely descend into it. Throws `E_VALIDATION` when the
 * key already holds something that is not an inline object literal (an
 * identifier, spread, or function call) — magicast cannot edit those, and
 * assigning into them otherwise throws a raw proxy `TypeError`. The object
 * sibling of {@link ensureArrayItem}.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ensureEditableObject(parent: any, key: string): any {
  if (parent[key] === undefined) {
    parent[key] = {};
  }
  const value = parent[key];
  if (value?.$type !== "object") {
    throw new ZitadelError("E_VALIDATION", `Could not edit "${key}" in the config`, {
      hint: `Set "${key}" to an inline object literal, or add the Zitadel settings manually.`,
    });
  }
  return value;
}
