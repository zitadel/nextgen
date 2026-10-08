import { readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { parse } from "yaml";

type Node = unknown;

/**
 * Inline every file `$ref` of the split spec into one document, the same way
 * orval does, except that a file which (directly or indirectly) references
 * itself is lifted into `components.schemas` and referenced from there.
 *
 * orval inlines external files that are not under `components.schemas`, so a
 * self-referencing file such as `user-property.yaml` (a property's nested
 * `properties` are user properties again) cannot be inlined: orval cuts the
 * loop with an empty schema and warns once per use. Handing orval a bundled
 * document keeps the recursion as a named model instead.
 */
export function bundleSpec(entry: string): Record<string, unknown> {
  const files = new Map<string, Node>();
  const load = (file: string): Node => {
    if (!files.has(file)) files.set(file, parse(readFileSync(file, "utf-8")));
    return files.get(file);
  };

  const target = (ref: string, from: string): string | undefined =>
    ref.startsWith("#") ? undefined : resolve(dirname(from), ref);

  // Files that sit on a reference cycle become components.
  const recursive = new Set<string>();
  const visit = (node: Node, from: string, stack: string[]): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, from, stack);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const ref = (node as Record<string, unknown>).$ref;
    const file = typeof ref === "string" ? target(ref, from) : undefined;
    if (file) {
      if (stack.includes(file)) recursive.add(file);
      else visit(load(file), file, [...stack, file]);
      return;
    }
    for (const value of Object.values(node)) visit(value, from, stack);
  };
  const root = load(entry) as Record<string, unknown>;
  visit(root, entry, [entry]);

  const names = new Map<string, string>();
  for (const file of recursive) {
    const title = (load(file) as Record<string, unknown>).title;
    names.set(file, typeof title === "string" ? title : pascal(basename(file, extname(file))));
  }

  const inline = (node: Node, from: string): Node => {
    if (Array.isArray(node)) return node.map((item) => inline(item, from));
    if (node === null || typeof node !== "object") return node;
    const ref = (node as Record<string, unknown>).$ref;
    const file = typeof ref === "string" ? target(ref, from) : undefined;
    if (file) {
      const name = names.get(file);
      if (name) return { $ref: `#/components/schemas/${name}` };
      return inline(load(file), file);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      // orval drops these from inlined files too.
      if (from !== entry && (key === "$schema" || key === "$id")) continue;
      out[key] = inline(value, from);
    }
    return out;
  };

  const bundled = inline(root, entry) as Record<string, unknown>;
  if (names.size > 0) {
    const components = (bundled.components ?? {}) as Record<string, unknown>;
    const schemas = (components.schemas ?? {}) as Record<string, unknown>;
    for (const [file, name] of names) schemas[name] = inline(load(file), file);
    bundled.components = { ...components, schemas };
  }
  return bundled;
}

function pascal(value: string): string {
  return value.replace(/(^|[-_])([a-z0-9])/g, (_, __, char: string) => char.toUpperCase());
}
