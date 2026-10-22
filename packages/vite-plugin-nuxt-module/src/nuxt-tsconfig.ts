import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { NUXT_BUILD_DIR, PROJECT_TSCONFIG } from "./defaults.ts";
import { anyTypeScript } from "./resolve.ts";
import { packageTsconfig, type TS } from "./tsconfig.ts";

interface TsconfigJson {
  readonly references?: readonly { readonly path: string }[];
  readonly extends?: unknown;
}

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

/**
 * The first file `file` extends or references by path (recursively) that does not exist, or `undefined` when the
 * chain is complete. A module's tsconfig usually extends `.nuxt/tsconfig.json`, which only `nuxi prepare` writes.
 * Each file is read as TypeScript reads it (comments, trailing commas, a byte-order mark), without applying its
 * chain, which is what is checked; package `extends` (`"@nuxt/tsconfig"`) are left to TypeScript.
 */
export function missingTsconfigFile(ts: TS, file: string): string | undefined {
  if (!isFile(file)) return file;
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error)
    throw new Error(
      `cannot read ${file}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
    );
  const json = (config ?? {}) as TsconfigJson;
  for (const ref of json.references ?? []) {
    const p = resolve(dirname(file), ref.path);
    if (!isFile(p) && !isFile(`${p}.json`) && !isFile(join(p, PROJECT_TSCONFIG))) return p;
  }
  const ext = json.extends;
  for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
    if (typeof e !== "string" || !(e.startsWith(".") || isAbsolute(e))) continue;
    const p = resolve(dirname(file), e);
    const target = isFile(p) || p.endsWith(".json") ? p : `${p}.json`;
    const missing = missingTsconfigFile(ts, target);
    if (missing) return missing;
  }
  return undefined;
}

/** Why the build cannot type the module with `tsconfig`, whose chain names `missing`, and what fixes it. */
export function brokenTsconfigMessage(root: string, tsconfig: string, missing: string): string {
  const generated = missing.split(sep).includes(NUXT_BUILD_DIR);
  return [
    `nuxtModule: ${relative(root, tsconfig) || tsconfig} needs ${relative(root, missing) || missing}, which does not exist.`,
    generated
      ? "It is written by `nuxi prepare`: run that before the build, or set `prepare: true` to have the build run it."
      : "Create it, or point `tsconfig` at a tsconfig whose chain is complete.",
  ].join(" ");
}

/**
 * The tsconfig the module is typed and transpiled with. A Nuxt module's tsconfig usually extends
 * `.nuxt/tsconfig.json` (Nuxt's aliases, `#app`, the hoisted `@nuxt/schema`): a build without it would type the module
 * with different options than the editor does, so a broken chain fails with what to run instead of being guessed at.
 */
export function effectiveTsconfig(root: string, tsconfig: string | undefined): string {
  const base = packageTsconfig(root, tsconfig);
  if (!base) throw new Error(`nuxtModule: no tsconfig found in ${root} or above it`);
  const missing = missingTsconfigFile(anyTypeScript(root), base);
  if (missing) throw new Error(brokenTsconfigMessage(root, base, missing));
  return base;
}

/**
 * {@link effectiveTsconfig}, or `undefined` when the module has no tsconfig at all and needs none (no declarations):
 * the transpiler then finds the nearest one itself.
 */
export function optionalTsconfig(
  root: string,
  tsconfig: string | undefined,
  required: boolean,
): string | undefined {
  const base = packageTsconfig(root, tsconfig);
  if (!required && (!base || !existsSync(base))) return undefined;
  return effectiveTsconfig(root, tsconfig);
}
