/**
 * Copies the dialect meta-schemas the server embeds
 * (`api/openapi/endpoints/schemas/*.json`) into `meta-schemas/`, the directory
 * `src/meta-schemas.ts` imports and `package.json` publishes.
 *
 * `meta-schemas/` is gitignored: this script is the only writer, and it runs
 * ahead of build, typecheck and test so the package never sees a stale or
 * hand-edited copy. The server-side directory is the single source.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(packageRoot, "../..", "api/openapi/endpoints/schemas");
const targetDir = join(packageRoot, "meta-schemas");

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

const files = readdirSync(sourceDir).filter((name) => name.endsWith(".json")).sort();
if (files.length === 0) {
  throw new Error(`no meta-schemas found in ${sourceDir}`);
}
for (const name of files) {
  writeFileSync(join(targetDir, name), readFileSync(join(sourceDir, name)));
}
