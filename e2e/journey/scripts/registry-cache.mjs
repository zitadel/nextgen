import { appendFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { isDirectRun } from "../../../scripts/dev-process.mjs";

// CI keeps the journey's Verdaccio store (JOURNEY_REGISTRY_STORAGE) in the
// Actions cache, and each save takes about 8 s. The store changes on every run
// whether or not it gained anything: Verdaccio rewrites a package's metadata
// whenever it revalidates it against npmjs, and local-registry.mjs republishes
// the @zitadel packages. Only new tarballs make a saved store worth more, and
// they arrive only when an install needs a version the store lacks. So CI
// lists the tarballs after the restore and again after the journey, and saves
// only when the second list has new ones.
//
//   node registry-cache.mjs list <storage> <list-file>
//   node registry-cache.mjs compare <storage> <list-file>
//
// `compare` writes `count=<new tarballs>` to $GITHUB_OUTPUT.

// Republished on every run, so never a reason to save.
const REPUBLISHED_SCOPE = "@zitadel/";

// A cold store makes every tarball new; the log names this many.
const LOGGED_NEW_TARBALLS = 50;

/**
 * The store's npmjs tarballs as sorted storage-relative paths
 * (`<name>/<name>-<version>.tgz`, `@scope/<name>/<name>-<version>.tgz`). A
 * missing store has none. Verdaccio downloads a tarball under a temporary name
 * and renames it when complete, so every `.tgz` here is a whole one.
 */
export async function listTarballs(storage) {
  let entries;
  try {
    entries = await readdir(storage, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => relative(storage, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.startsWith(REPUBLISHED_SCOPE))
    .sort();
}

/** The tarballs in `current` that `restored` lacks. */
export function newTarballs(restored, current) {
  const known = new Set(restored);
  return current.filter((path) => !known.has(path));
}

/**
 * The restored list as `list` wrote it. Without one, every tarball counts as
 * new, so the store is saved as it was before this check existed.
 */
export async function readTarballList(listFile) {
  try {
    return (await readFile(listFile, "utf8")).split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, storage, listFile] = argv;
  if (!["list", "compare"].includes(command) || !storage || !listFile) {
    throw new Error("usage: node registry-cache.mjs <list|compare> <storage> <list-file>");
  }
  const current = await listTarballs(storage);
  if (command === "list") {
    await writeFile(listFile, current.map((path) => `${path}\n`).join(""));
    console.log(`journey registry: ${current.length} tarballs restored`);
    return;
  }
  const restored = await readTarballList(listFile);
  const added = newTarballs(restored, current);
  console.log(
    `journey registry: ${restored.length} tarballs restored, ${current.length} now, ${added.length} new`,
  );
  for (const path of added.slice(0, LOGGED_NEW_TARBALLS)) {
    console.log(`  ${path}`);
  }
  if (added.length > LOGGED_NEW_TARBALLS) {
    console.log(`  … and ${added.length - LOGGED_NEW_TARBALLS} more`);
  }
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `count=${added.length}\n`);
  }
}

if (isDirectRun(import.meta.url)) {
  await main();
}
