import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformWithOxc } from "vite";

import { packageSass } from "./sass.ts";
import { importFromRoot, realPackageDirectory } from "./resolve.ts";
import { SASS_RE } from "./specifiers.ts";

/**
 * Where `vue-sfc-transformer` is looked for after the module itself: the packages `nuxt-module-build`
 * reaches it through (`@nuxt/module-builder` → `unbuild` → `mkdist`), each resolved from the previous.
 */
export const SFC_TRANSFORMER_CHAIN: readonly string[] = [
  "@nuxt/module-builder",
  "unbuild",
  "mkdist",
];

/** The mkdist loader entry of `vue-sfc-transformer`. */
export const SFC_TRANSFORMER = "vue-sfc-transformer/mkdist";

/** A file as mkdist's loaders see it. */
export interface LoaderInput {
  readonly extension: string;
  readonly getContents: () => string | Promise<string>;
  /** The file a block came from (`Comp.vue.scss`), so relative `@use` / `@import` resolve. */
  readonly srcPath?: string;
}

/** What a loader returns per output file. */
export interface LoaderOutput {
  readonly contents: string;
  readonly extension: string;
}

/** mkdist's `vueLoader`, as `vue-sfc-transformer` exports it. */
export interface VueLoader {
  vueLoader(
    input: LoaderInput & { readonly path: string; readonly srcPath: string },
    context: {
      readonly options: { readonly esbuild: Record<string, never> };
      readonly loadFile: (file: LoaderInput) => Promise<LoaderOutput[]>;
    },
  ): Promise<readonly { readonly contents: string }[] | undefined>;
}

/**
 * mkdist's `loadFile` as `vue-sfc-transformer` calls it for the pieces of an SFC that are not `<script>`, for a module
 * at `root`:
 *
 * - each TypeScript expression of a `<template>` (`$attrs.x as string`) comes through as a `.ts` snippet and must come
 *   back as JS, or the shipped `.vue` keeps TS the consuming app's template compiler rejects;
 * - a `<style lang="scss|sass">` block is compiled to CSS with the module's own Sass, like mkdist's Sass loader, so the
 *   consuming app needs no Sass of its own.
 *
 * Anything else (plain CSS) is left as written.
 */
export function sfcSnippetLoader(root: string): (file: LoaderInput) => Promise<LoaderOutput[]> {
  return async (file) => {
    if (SASS_RE.test(file.extension)) {
      const sass = await packageSass(root);
      const { css } = sass.compileString(await file.getContents(), {
        syntax: file.extension === ".sass" ? "indented" : "scss",
        loadPaths: [join(root, "node_modules")],
        ...(file.srcPath ? { url: pathToFileURL(file.srcPath) } : {}),
      });
      return [{ contents: css, extension: ".css" }];
    }
    if (!/^\.(?:[cm]?ts|tsx)$/.test(file.extension)) return [];
    const { code } = await transformWithOxc(await file.getContents(), `snippet${file.extension}`, {
      target: "esnext",
      sourcemap: false,
      tsconfig: { compilerOptions: {} },
    } as Parameters<typeof transformWithOxc>[2]);
    return [{ contents: code, extension: ".mjs" }];
  };
}

/**
 * `root`, then the installed directory of each package in `chain`: resolved from the previous one found (its own
 * dependency), else from `root` (the module installs it directly). A package installed nowhere is skipped.
 */
export function dependencyChain(root: string, chain: readonly string[]): string[] {
  const dirs = [root];
  for (const name of chain) {
    const from = dirs[dirs.length - 1] ?? root;
    const found =
      realPackageDirectory(name, from) ??
      (from === root ? undefined : realPackageDirectory(name, root));
    if (found) dirs.push(found);
  }
  return dirs;
}

const vueLoaderCache = new Map<string, Promise<VueLoader>>();

/**
 * `vue-sfc-transformer` (the SFC loader `mkdist` uses), from the module's own dependencies first, then from the copy
 * `nuxt-module-build` would have used: a module usually declares only `@nuxt/module-builder`, so with a strict (pnpm)
 * layout the transformer is reachable only through its `@nuxt/module-builder` → `unbuild` → `mkdist` chain. A runtime
 * with `.vue` files needs it: shipped with their TypeScript, the consuming app's template compiler rejects them.
 */
export function vueTransformer(root: string): Promise<VueLoader> {
  let loader = vueLoaderCache.get(root);
  if (!loader) {
    loader = (async () => {
      const errors: string[] = [];
      for (const base of dependencyChain(root, SFC_TRANSFORMER_CHAIN)) {
        try {
          return await importFromRoot<VueLoader>(SFC_TRANSFORMER, base);
        } catch (error) {
          // not resolvable from this package: try the next one down the chain
          errors.push(String(error));
        }
      }
      throw new Error(
        `nuxtModule: the runtime has .vue files; install vue-sfc-transformer to strip their TypeScript (${errors.join("; ")})`,
      );
    })();
    vueLoaderCache.set(root, loader);
  }
  return loader;
}

/** One runtime `.vue` file with its TypeScript stripped and its Sass compiled, like `mkdist` does. */
export async function transformSfc(root: string, from: string, rel: string): Promise<string> {
  const transformer = await vueTransformer(root);
  const [sfc] =
    (await transformer.vueLoader(
      {
        extension: ".vue",
        path: from,
        srcPath: from,
        getContents: async () => readFileSync(from, "utf8"),
      },
      { options: { esbuild: {} }, loadFile: sfcSnippetLoader(root) },
    )) ?? [];
  if (!sfc) throw new Error(`vue-sfc-transformer returned nothing for ${rel}`);
  return sfc.contents;
}
