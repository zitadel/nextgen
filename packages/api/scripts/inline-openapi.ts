import { readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

import { parse } from "yaml";

type Node = unknown;
type Schemas = Record<string, Node>;

// orval inlines the spec's file `$ref`s itself, but breaks a recursive one
// into an empty schema, which the client then types as `unknown` — the user
// property meta-schema nests user properties inside its `properties`. This
// inlines the same way (siblings of a `$ref` dropped, `$schema` and `$id`
// scrubbed, like orval does), except that a `$ref` back into a file already
// being inlined becomes a reference to a component of that file's schema, so
// the client keeps the recursion as a named type.
//
// api/openapi's `$ref`s all name whole files; one with a fragment (`#…`) is
// left untouched.
export function inlineOpenApi(rootFile: string): Record<string, Node> {
  const root = resolve(rootFile);
  const cache = new Map<string, Node>();
  const components: Schemas = {};
  const names = new Map<string, string>();

  const load = (file: string): Node => {
    if (!cache.has(file)) {
      cache.set(file, parse(readFileSync(file, "utf8")));
    }
    return cache.get(file);
  };

  const componentName = (file: string): string => {
    const known = names.get(file);
    if (known) {
      return known;
    }
    const doc = load(file) as { title?: unknown };
    const title = typeof doc?.title === "string" ? doc.title : "";
    const name = /^[A-Za-z0-9._-]+$/.test(title) ? title : basename(file, extname(file));
    if ([...names.values()].includes(name)) {
      throw new Error(`two recursive schemas would share the component name ${name}`);
    }
    names.set(file, name);
    // Set before inlining, so the file's own `$ref`s back to it stop here.
    components[name] = {};
    components[name] = inline(scrub(load(file)), file, new Set([file]));
    return name;
  };

  const inline = (node: Node, file: string, chain: Set<string>): Node => {
    if (Array.isArray(node)) {
      return node.map((item) => inline(item, file, chain));
    }
    if (node === null || typeof node !== "object") {
      return node;
    }
    const ref = (node as { $ref?: unknown }).$ref;
    if (typeof ref === "string" && !ref.includes("#")) {
      const target = resolve(dirname(file), ref);
      if (chain.has(target)) {
        const name = names.get(target) ?? componentName(target);
        return { $ref: `#/components/schemas/${name}` };
      }
      return inline(scrub(load(target)), target, new Set([...chain, target]));
    }
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, inline(value, file, chain)]),
    );
  };

  const doc = inline(load(root), root, new Set([root])) as Record<string, Node> & {
    components?: Record<string, Node> & { schemas?: Schemas };
  };
  if (Object.keys(components).length > 0) {
    doc.components = { ...doc.components, schemas: { ...doc.components?.schemas, ...components } };
  }
  return doc;
}

function scrub(node: Node): Node {
  if (Array.isArray(node)) {
    return node.map(scrub);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== "$schema" && key !== "$id")
      .map(([key, value]) => [key, scrub(value)]),
  );
}
