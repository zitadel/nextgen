import { appendFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { isDirectRun } from "../../../scripts/dev-process.mjs";
// A namespace import, so a local-registry.mjs that sets no UPLINK_MAXAGE reads
// as undefined instead of failing to link.
import * as localRegistry from "./local-registry.mjs";

// CI keeps the journey's Verdaccio store (JOURNEY_REGISTRY_STORAGE) in the
// Actions cache, and each save takes about 8 s. A save pays off only when the
// journey changed what a later run gets from the store:
// - new tarballs, which arrive when an install needs a version the store lacks;
// - refreshed packuments that are still fresh when a later run asks for them.
//   Verdaccio rewrites a package.json only when it revalidated it against
//   npmjs, and asks npmjs again once it is the uplink's `maxage` old. Runs
//   restore a store minutes after it was saved, so under the 2-minute default
//   a refresh never lasts that long, and every run refreshes what it uses
//   anyway. A longer UPLINK_MAXAGE in local-registry.mjs makes refreshes worth
//   saving. It is read from that module rather than from the Verdaccio config
//   it writes, because a green journey deletes its work dir, config included.
// The @zitadel packages never count: local-registry.mjs republishes them on
// every run. CI lists the tarballs after the restore; after the journey,
// `compare` checks for new tarballs and for packuments written since that list.
//
//   node registry-cache.mjs list <storage> <list-file>
//   node registry-cache.mjs compare <storage> <list-file>
//
// `compare` writes `save=true|false` to $GITHUB_OUTPUT.

// Republished on every run, so never a reason to save.
const REPUBLISHED_SCOPE = "@zitadel/";

// Verdaccio's uplink `maxage` when the config sets none.
export const DEFAULT_MAXAGE_MS = 2 * 60_000;

// Verdaccio's interval units (parseInterval in its lib/utils.js); no unit is
// seconds.
const INTERVAL_UNITS = {
  "": 1000,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  M: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

// A cold store makes every tarball new; the log names this many.
const LOGGED_NEW_TARBALLS = 50;

// The store's files as sorted storage-relative paths, without the republished
// scope. A missing store has none.
async function storeFiles(storage) {
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
    .filter((entry) => entry.isFile())
    .map((entry) => relative(storage, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.startsWith(REPUBLISHED_SCOPE))
    .sort();
}

/**
 * The store's npmjs tarballs (`<name>/<name>-<version>.tgz`,
 * `@scope/<name>/<name>-<version>.tgz`). Verdaccio downloads a tarball under a
 * temporary name and renames it when complete, so every `.tgz` here is a whole
 * one.
 */
export async function listTarballs(storage) {
  return (await storeFiles(storage)).filter((path) => path.endsWith(".tgz"));
}

/**
 * The packuments (`<name>/package.json`) written after `since` (epoch ms):
 * those the journey revalidated against npmjs or fetched for the first time.
 */
export async function packumentsWrittenSince(storage, since) {
  const written = [];
  for (const path of await storeFiles(storage)) {
    if (path.endsWith("/package.json") && (await stat(join(storage, path))).mtimeMs > since) {
      written.push(path);
    }
  }
  return written;
}

/**
 * A Verdaccio interval (`1h`, `90s`, `1h 30m`, or a number of seconds) in ms,
 * read the way Verdaccio reads `maxage`; undefined when it cannot be read.
 */
export function parseInterval(interval) {
  if (typeof interval === "number") {
    return interval * 1000;
  }
  const parts = typeof interval === "string" ? interval.trim().split(/\s+/) : [""];
  let total = 0;
  for (const part of parts) {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|y|)$/.exec(part);
    if (!match) {
      return undefined;
    }
    total += Number(match[1]) * INTERVAL_UNITS[match[2]];
  }
  return total;
}

/** The uplink's maxage in ms: `interval`, or Verdaccio's default without one. */
export function maxageMs(interval) {
  return parseInterval(interval) ?? DEFAULT_MAXAGE_MS;
}

/** The tarballs in `current` that `restored` lacks. */
export function newTarballs(restored, current) {
  const known = new Set(restored);
  return current.filter((path) => !known.has(path));
}

/**
 * The restored list as `list` wrote it, and when it was written. Without one,
 * every tarball counts as new, so the store is saved as it was before this
 * check existed.
 */
export async function readTarballList(listFile) {
  try {
    const [text, info] = await Promise.all([readFile(listFile, "utf8"), stat(listFile)]);
    return { tarballs: text.split("\n").filter(Boolean), listedAt: info.mtimeMs };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { tarballs: [], listedAt: 0 };
    }
    throw error;
  }
}

/**
 * What the journey changed in the store since `list` wrote `listFile`, and
 * whether that is worth a save. `maxage` is the npmjs uplink's, as a Verdaccio
 * interval (local-registry.mjs's UPLINK_MAXAGE).
 */
export async function compareStore({ storage, listFile, maxage }) {
  const current = await listTarballs(storage);
  const { tarballs: restored, listedAt } = await readTarballList(listFile);
  const added = newTarballs(restored, current);
  const refreshed = await packumentsWrittenSince(storage, listedAt);
  const maxageInMs = maxageMs(maxage);
  const refreshesLast = maxageInMs > DEFAULT_MAXAGE_MS;
  const save = added.length > 0 || (refreshesLast && refreshed.length > 0);
  return { restored, current, added, refreshed, maxageInMs, refreshesLast, save };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, storage, listFile] = argv;
  if (!["list", "compare"].includes(command) || !storage || !listFile) {
    throw new Error("usage: node registry-cache.mjs <list|compare> <storage> <list-file>");
  }
  if (command === "list") {
    const current = await listTarballs(storage);
    await writeFile(listFile, current.map((path) => `${path}\n`).join(""));
    console.log(`journey registry: ${current.length} tarballs restored`);
    return;
  }
  const { restored, current, added, refreshed, maxageInMs, refreshesLast, save } =
    await compareStore({ storage, listFile, maxage: localRegistry.UPLINK_MAXAGE });
  console.log(
    `journey registry: ${restored.length} tarballs restored, ${current.length} now, ${added.length} new`,
  );
  for (const path of added.slice(0, LOGGED_NEW_TARBALLS)) {
    console.log(`  ${path}`);
  }
  if (added.length > LOGGED_NEW_TARBALLS) {
    console.log(`  … and ${added.length - LOGGED_NEW_TARBALLS} more`);
  }
  console.log(
    `journey registry: ${refreshed.length} packuments refreshed; with an uplink maxage of ${maxageInMs / 1000} s they ${refreshesLast ? "count" : "do not count"}`,
  );
  console.log(`journey registry: ${save ? "saving" : "not saving"} the store`);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `save=${save}\n`);
  }
}

if (isDirectRun(import.meta.url)) {
  await main();
}
