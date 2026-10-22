import { type RolldownPlugin, RolldownMagicString } from "rolldown";
import { parseAst } from "rolldown/parseAst";

import { PLUGIN_PREFIX } from "../defaults.ts";

/** The parser language of a declaration-step module: `.d.ts` files, `.tsx`, else TypeScript. */
function languageOf(id: string): "dts" | "tsx" | "ts" {
  if (/\.d\.[cm]?ts$/.test(id)) return "dts";
  return id.endsWith(".tsx") ? "tsx" : "ts";
}

/** How a module re-exports packages wholesale: `export type * from "x"` (type) or `export * from "x"` (value). */
export interface StarReExports {
  readonly typeOnly: readonly string[];
  readonly value: readonly string[];
}

/** The bare (package) specifiers `code` re-exports wholesale (`export * from "pkg"`), by kind. */
export function starReExports(code: string, id: string): StarReExports {
  const typeOnly: string[] = [];
  const value: string[] = [];
  let body: ReturnType<typeof parseAst>["body"];
  try {
    body = parseAst(code, { lang: languageOf(id), sourceType: "module" }, id).body;
  } catch {
    return { typeOnly, value };
  }
  for (const node of body) {
    if (node.type !== "ExportAllDeclaration" || node.exported) continue;
    const source = node.source.value;
    if (source.startsWith(".") || source.startsWith("/")) continue;
    (node.exportKind === "type" ? typeOnly : value).push(source);
  }
  return { typeOnly, value };
}

/**
 * `code` (a rendered declaration chunk) with `type` given back to each `export * from "<pkg>"` of
 * `typeOnly`, and an empty `export {}` added when it has no module syntax at all, which would
 * make every declaration in it global. `null` when nothing changes.
 */
export function finishedDeclaration(
  code: string,
  typeOnly: ReadonlySet<string>,
): { code: string; map: string } | null {
  const { body } = parseAst(code, { lang: "dts", sourceType: "module" });
  const s = new RolldownMagicString(code);
  for (const node of body)
    if (
      node.type === "ExportAllDeclaration" &&
      !node.exported &&
      node.exportKind !== "type" &&
      typeOnly.has(node.source.value)
    )
      s.appendLeft(node.start + "export".length, " type");
  const moduleSyntax = body.some(
    (node) => node.type.startsWith("Export") || node.type === "ImportDeclaration",
  );
  if (!moduleSyntax) s.append("\nexport {};\n");
  if (!s.hasChanged()) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true }).toString() };
}

/**
 * Finishes the declaration chunks rolldown-plugin-dts renders. It flattens a type-only star
 * re-export of a package below the entry (`types.ts`: `export type * from "pkg"`, re-exported by
 * the entry's `export * from "./types"`) into a value one, so the published types claim the
 * package's runtime values as the entry's own; it keeps the modifier only on the entry module's own
 * re-exports. Each such package that no module re-exports as values gets its `type` back here (a
 * package re-exported both ways stays a value re-export). And a chunk with no module syntax gets
 * `export {}`, as `tsc` writes it.
 */
export function finishedDeclarations(): RolldownPlugin {
  const typeOnly = new Set<string>();
  const value = new Set<string>();
  return {
    name: `${PLUGIN_PREFIX}:dts-finish`,
    buildStart() {
      typeOnly.clear();
      value.clear();
    },
    transform: {
      order: "pre",
      filter: { id: /\.[cm]?tsx?$/ },
      handler(code, id) {
        const found = starReExports(code, id);
        for (const source of found.typeOnly) typeOnly.add(source);
        for (const source of found.value) value.add(source);
        return null;
      },
    },
    renderChunk: {
      order: "post",
      handler(code) {
        return finishedDeclaration(
          code,
          new Set([...typeOnly].filter((source) => !value.has(source))),
        );
      },
    },
  };
}
