import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";

/**
 * Vite/Rollup plugin: import `.liquid` template files as default-exported
 * strings (`import tpl from "./file.liquid"`).
 *
 * `resolveId` tags `.liquid` imports with a `\0liquid:` virtual prefix so
 * Vite's built-in loaders don't try to parse the Liquid syntax as JS, then
 * `load` returns the file contents as a JS default export.
 *
 * Shared by every Vite-based consumer of `@zitadel/components` source: the
 * package's own `vitest.config.ts` and the Storybook dev server
 * (`apps/storybook/.storybook/main.ts`). The production build uses the
 * rolldown variant in `tsdown.config.ts`.
 */
export function liquidRaw(): Plugin {
  return {
    name: "liquid-raw",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.endsWith(".liquid") && importer) {
        const dir = importer.replace(/\/[^/]*$/, "");
        return `\0liquid:${resolve(dir, source)}`;
      }
      return null;
    },
    load(id) {
      if (!id.startsWith("\0liquid:")) return null;
      const content = readFileSync(id.slice("\0liquid:".length), "utf-8");
      return `export default ${JSON.stringify(content)};`;
    },
  };
}
