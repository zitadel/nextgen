import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAst } from "vite";

import { namesFile } from "./package-json.ts";

/** An identifier or string literal naming an export. */
interface ExportName {
  readonly name?: string;
  readonly value?: string;
}

/** A top-level statement of the module declaration, as far as the export scan reads it. */
interface Statement {
  readonly type: string;
  readonly declaration?: {
    readonly id?: { readonly name?: string } | null;
    readonly declarations?: readonly { readonly id?: { readonly name?: string } }[];
  } | null;
  readonly specifiers?: readonly { readonly exported: ExportName }[];
  readonly source?: { readonly value: string } | null;
}

interface Reexport {
  readonly names: string[];
  readonly star: boolean;
  readonly specifier?: string;
}

/** The module declaration's exports: every name, and each export statement to re-export. */
function scanExports(declaration: string): { names: Set<string>; reexports: Reexport[] } {
  const ast = parseAst(declaration, { lang: "ts" }) as unknown as { body: readonly Statement[] };
  const names = new Set<string>();
  const reexports: Reexport[] = [];
  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration) {
        const id = node.declaration.id?.name ?? node.declaration.declarations?.[0]?.id?.name;
        if (id) {
          names.add(id);
          reexports.push({ names: [id], star: false });
        }
      }
      for (const s of node.specifiers ?? []) {
        const exported = s.exported.name ?? s.exported.value ?? "";
        names.add(exported);
        reexports.push({
          names: [exported],
          star: false,
          ...(node.source ? { specifier: node.source.value } : {}),
        });
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      names.add("default");
      reexports.push({ names: ["default"], star: false });
    } else if (node.type === "ExportAllDeclaration" && node.source) {
      reexports.push({ names: [], star: true, specifier: node.source.value });
    }
  }
  return { names, reexports };
}

/** Module exports that extend a Nuxt interface, and where that interface is declared. */
const HOOKS: readonly {
  readonly name: string;
  readonly module: "#app" | "@nuxt/schema";
  readonly shim: string;
}[] = [
  {
    name: "ModuleHooks",
    module: "@nuxt/schema",
    shim: "  interface NuxtHooks extends ModuleHooks {}",
  },
  {
    name: "ModuleRuntimeHooks",
    module: "#app",
    shim: "  interface RuntimeNuxtHooks extends ModuleRuntimeHooks {}",
  },
  {
    name: "ModuleRuntimeConfig",
    module: "@nuxt/schema",
    shim: "  interface RuntimeConfig extends ModuleRuntimeConfig {}",
  },
  {
    name: "ModulePublicRuntimeConfig",
    module: "@nuxt/schema",
    shim: "  interface PublicRuntimeConfig extends ModulePublicRuntimeConfig {}",
  },
];

/**
 * The `types` declaration `@nuxt/module-builder` writes for a module whose declaration is
 * `declaration` and whose entry is `moduleFile` (`./module.mjs`): the module's public types plus
 * `#app` / `@nuxt/schema` hooks and runtime config shims.
 */
export function typesEntry(declaration: string, moduleFile: string): string {
  const { names, reexports } = scanExports(declaration);
  const schemaImports: string[] = [];
  const moduleImports: string[] = [];
  const appShims: string[] = [];
  const schemaShims: string[] = [];
  const moduleExports: string[] = [];
  if (!names.has("ModuleOptions")) {
    schemaImports.push("NuxtModule");
    moduleImports.push("default as Module");
    moduleExports.push(
      "export type ModuleOptions = typeof Module extends NuxtModule<infer O> ? Partial<O> : Record<string, any>",
    );
  }
  for (const hook of HOOKS) {
    if (!names.has(hook.name)) continue;
    moduleImports.push(hook.name);
    (hook.module === "#app" ? appShims : schemaShims).push(hook.shim);
  }
  const named = reexports
    .filter((e) => !e.star)
    .map(
      (e) =>
        `\nexport { ${e.names.map((n) => (n === "default" ? "" : "type ") + n).join(", ")} } from '${e.specifier ?? moduleFile}'`,
    );
  const stars = reexports
    .filter((e) => e.star)
    .map((e) => `\nexport * from '${e.specifier ?? moduleFile}'`);
  const text = `
  ${schemaImports.length ? `import type { ${schemaImports.join(", ")} } from '@nuxt/schema'` : ""}

${moduleImports.length ? `import type { ${moduleImports.join(", ")} } from '${moduleFile}'` : ""}

${appShims.length ? `declare module '#app' {\n${appShims.join("\n")}\n}\n` : ""}
${schemaShims.length ? `declare module '@nuxt/schema' {\n${schemaShims.join("\n")}\n}\n` : ""}
${moduleExports.length ? `\n${moduleExports.join("\n")}` : ""}
${named.join("")}
${stars.join("")}
`;
  return `${text.trim().replace(/[\n\r]{3,}/g, "\n\n")}\n`;
}

/**
 * Writes `types.d.mts` (`types.d.ts` for a `.js` build) next to the module, when the manifest of the
 * package at `root` names it (see `namesFile`) and the module does not ship its own.
 */
export function writeTypesEntry(root: string, outDir: string, extension: string): void {
  const mjs = extension === ".mjs";
  // Paired with the module's own declaration extension: `module.mjs` → `types.d.mts`, `module.js` → `types.d.ts`.
  const file = join(outDir, mjs ? "types.d.mts" : "types.d.ts");
  if (existsSync(file) || !namesFile(root, file)) return;
  const declaration = readFileSync(join(outDir, mjs ? "module.d.mts" : "module.d.ts"), "utf8");
  writeFileSync(file, typesEntry(declaration, `./module${extension}`));
}
