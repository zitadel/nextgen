import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Every file under `dir`, relative to it with forward slashes, sorted; `node_modules` is skipped. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  visit(dir);
  return out.sort();
}
