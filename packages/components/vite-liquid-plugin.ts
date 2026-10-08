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
    async resolveId(source, importer, options) {
      if (!source.endsWith(".liquid") || !importer) return null;
      if (source.startsWith(".")) {
        const dir = importer.replace(/\/[^/]*$/, "");
        return `\0liquid:${resolve(dir, source)}`;
      }
      // A package specifier (`@zitadel/config/defaults/…`): resolve it through
      // the package's exports as Vite would.
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved ? `\0liquid:${resolved.id}` : null;
    },
    load(id) {
      if (!id.startsWith("\0liquid:")) return null;
      const content = readFileSync(id.slice("\0liquid:".length), "utf-8");
      return `export default ${JSON.stringify(content)};`;
    },
  };
}
