/**
 * Copies the dialect meta-schemas the server embeds
 * (`api/openapi/endpoints/schemas/*.json`) into `meta-schemas/`, the directory
 * `src/meta-schemas.ts` imports and `package.json` publishes.
 *
 * `meta-schemas/` is gitignored: this script is the only writer, and it runs
 * ahead of build, typecheck and test so the package never sees a stale or
 * hand-edited copy. The server-side directory is the single source.
 *
 * Safe under concurrent callers: `moon ci` runs typecheck and build as
 * siblings, and each package script invokes this sync. The directory is never
 * removed, an unchanged file is left untouched, a changed file is written to
 * a temp name and renamed into place (atomic on POSIX and NTFS), and only
 * `.json` files with no counterpart in the source are deleted.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(packageRoot, "../..", "api/openapi/endpoints/schemas");
const targetDir = join(packageRoot, "meta-schemas");

const files = readdirSync(sourceDir).filter((name) => name.endsWith(".json")).sort();
if (files.length === 0) {
  throw new Error(`no meta-schemas found in ${sourceDir}`);
}

mkdirSync(targetDir, { recursive: true });

for (const name of files) {
  const body = readFileSync(join(sourceDir, name));
  const target = join(targetDir, name);
  if (existsSync(target) && readFileSync(target).equals(body)) {
    continue;
  }
  const tmp = join(targetDir, `.${name}.${process.pid}.tmp`);
  writeFileSync(tmp, body);
  renameSync(tmp, target);
}

const wanted = new Set(files);
for (const name of readdirSync(targetDir)) {
  if (name.endsWith(".json") && !wanted.has(name)) {
    rmSync(join(targetDir, name), { force: true });
  }
}
