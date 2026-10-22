import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { version as viteVersion } from "vite";

import { MODULE_JSON } from "./defaults.ts";
import { readPackageJson } from "./package-json.ts";

/** What a built Nuxt module's default export may tell about itself. */
interface ModuleExport {
  readonly default?: {
    readonly getMeta?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  };
}

/** The `name` and `version` of this package, read from the manifest next to `src` / `dist`. */
function ownPackage(): { readonly name: string; readonly version: string } {
  return JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
  ) as {
    name: string;
    version: string;
  };
}

/** The tools a module was built with, as `module.json` records them: this plugin and Vite. */
export function builderMeta(): Record<string, string> {
  const { name, version } = ownPackage();
  return { [name]: version, vite: viteVersion };
}

/**
 * The `module.json` of a built module: what its `getMeta()` returns, the package's name and version
 * where it gives none, the builder, then `extra`.
 */
export function moduleJson(
  meta: Readonly<Record<string, unknown>>,
  pkg: { readonly name?: string; readonly version?: string },
  extra: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...meta };
  if (!merged.name) merged.name = pkg.name;
  if (!merged.version) merged.version = pkg.version;
  merged.builder = builderMeta();
  return { ...merged, ...extra };
}

/** Imports the built `module<extension>` from `outDir` and writes its `module.json` next to it. */
export async function writeModuleJson(o: {
  readonly root: string;
  readonly outDir: string;
  readonly extension: string;
  readonly moduleMeta: Readonly<Record<string, unknown>> | undefined;
}): Promise<void> {
  const file = join(o.outDir, `module${o.extension}`);
  const mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as ModuleExport;
  const meta = (await mod.default?.getMeta?.()) ?? {};
  const json = moduleJson(meta, readPackageJson(o.root), o.moduleMeta);
  writeFileSync(join(o.outDir, MODULE_JSON), JSON.stringify(json, null, 2));
}
