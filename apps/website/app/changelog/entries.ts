import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lt, prerelease, rcompare, valid } from "semver";

// The changelog's data, read from the repository when the site builds: its
// entries, apps/website/changelog/<slug>.md, one per notable change, and the
// releases that ship them. The cloud runs main, so a change to the server
// reaches preview.zitadel.com when it merges, and everyone else with the
// release that carries it: an entry says when it landed, and the site finds
// its release from the CHANGELOG.md Changesets writes into each published
// package (the fixed group in .changeset/config.json).
//
// The pages are static: the site reads these files only while it builds, so
// its server functions need none of them. turbopackIgnore keeps Turbopack
// from tracing the whole repository into them for each read below.

const REPOSITORY = "https://github.com/zitadel/nextgen";

/**
 * The first release the changelog knows. The `1.0.0-alpha.N` previews before
 * it are deprecated (docs/adrs/074-preview-releases-on-0x.md); GitHub keeps
 * them.
 */
export const FIRST_RELEASE = "0.1.0";

/** The entries, from the repository's root. */
const ENTRIES = "apps/website/changelog";

/** An entry's page ([slug]/page.tsx). */
export function entryPath(slug: string): string {
  return `/changelog/${encodeURIComponent(slug)}`;
}

// The server's binaries for each platform, whose CHANGELOG.md says only that
// nothing changed.
const PLATFORM_PACKAGE = /^@zitadel\/server-(?:darwin|linux|win32)-/;

/** A published version, and its release notes on GitHub. */
export type Release = { version: string; tag: string; url: string };

export type Entry = {
  /** Its file's name, which names its page: /changelog/<slug>. */
  slug: string;
  title: string;
  /** A sentence or two of plain text, for the index and the feed. */
  summary: string;
  /** When it landed, in UTC: `2026-10-21`, or with the time, `2026-10-21T14:24Z`. */
  date: string;
  /** Whether it was live on preview.zitadel.com from `date`, before its release. */
  cloud: boolean;
  /** The pull requests that shipped it. */
  pulls: number[];
  /** The release that carries all of them, none until one does. */
  release?: Release;
  /** Its story, Markdown. */
  body: string;
};

/** The entries, the newest first, and the releases, the highest first. */
export type Changelog = { entries: Entry[]; releases: Release[] };

/** A published package's CHANGELOG.md. */
export type PackageChangelog = { name: string; source: string };

/** The changelog. `next build` runs in apps/website, two folders below the repository's root. */
export function readChangelog(
  root = join(/* turbopackIgnore: true */ process.cwd(), "..", ".."),
): Changelog {
  return assembleChangelog(readPackageChangelogs(root), readEntries(join(root, ENTRIES)));
}

/**
 * The published packages' CHANGELOG.md, in the fixed group's order: each one
 * under apps/ or packages/ whose title names a package of the group.
 */
export function readPackageChangelogs(root: string): PackageChangelog[] {
  const config = JSON.parse(
    readFileSync(/* turbopackIgnore: true */ join(root, ".changeset", "config.json"), "utf8"),
  ) as { fixed?: string[][] };
  const found = new Map<string, string>();
  for (const folder of ["apps", "packages"]) {
    const parent = join(/* turbopackIgnore: true */ root, folder);
    for (const entry of readdirSync(/* turbopackIgnore: true */ parent, { withFileTypes: true })) {
      const source = entry.isDirectory()
        ? readIfAny(join(/* turbopackIgnore: true */ parent, entry.name, "CHANGELOG.md"))
        : undefined;
      const name = source && /^# (\S+)/.exec(source)?.[1];
      if (source && name) found.set(name, source);
    }
  }
  return (config.fixed ?? [])
    .flat()
    .filter((name) => !PLATFORM_PACKAGE.test(name))
    .flatMap((name) => {
      const source = found.get(name);
      return source ? [{ name, source }] : [];
    });
}

/** The entries in a folder, each without its release. */
export function readEntries(folder: string): Omit<Entry, "release">[] {
  return readdirSync(/* turbopackIgnore: true */ folder)
    .filter((file) => file.endsWith(".md"))
    .map((file) =>
      parseEntry(file, readFileSync(/* turbopackIgnore: true */ join(folder, file), "utf8")),
    );
}

/**
 * An entry: its front matter, one `field: value` a line, then its story.
 * Throws on a field it does not know or a value it cannot read, so a broken
 * entry fails the build.
 */
export function parseEntry(file: string, source: string): Omit<Entry, "release"> {
  const fail = (problem: string): never => {
    throw new Error(`${file}: ${problem}`);
  };
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) fail("an entry starts with its front matter between two --- lines");
  const [, frontMatter = "", body = ""] = match ?? [];
  const fields = new Map<string, string>();
  for (const line of frontMatter.split(/\r?\n/).filter((line) => line.trim())) {
    const [, key = "", value = ""] =
      /^(\w+):\s*(.*?)\s*$/.exec(line) ?? fail(`not a field: "${line}"`);
    if (!["title", "summary", "date", "cloud", "pulls"].includes(key)) fail(`no field ${key}`);
    if (fields.has(key)) fail(`${key} twice`);
    fields.set(key, value);
  }
  const json = (key: string, value: string): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      return fail(`${key} is not ${value}`);
    }
  };
  const text = (key: string) => {
    const value = fields.get(key) ?? fail(`no ${key}`);
    return value.startsWith('"') ? String(json(key, value)) : value;
  };
  const date = text("date");
  // Date rolls 2026-02-30 over into March, so the day must come back as written.
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}Z)?$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date.slice(0, 10)).toISOString().slice(0, 10) !== date.slice(0, 10)
  ) {
    fail(`date is 2026-10-21 or 2026-10-21T14:24Z, not ${date}`);
  }
  const cloud = fields.get("cloud") ?? "false";
  if (cloud !== "true" && cloud !== "false") fail(`cloud is true or false, not ${cloud}`);
  const pulls = json("pulls", fields.get("pulls") ?? "[]");
  if (!Array.isArray(pulls) || !pulls.every((pull) => Number.isInteger(pull) && pull > 0)) {
    fail(`pulls is a list of pull request numbers, such as [2187, 2190]`);
  }
  return {
    slug: file.replace(/\.md$/, ""),
    title: text("title"),
    summary: text("summary"),
    date,
    cloud: cloud === "true",
    pulls: pulls as number[],
    body: body.trim(),
  };
}

/**
 * The entries, the newest first, each with the release that carries every
 * pull request it names (the highest, when they shipped in several), and the
 * releases from FIRST_RELEASE on.
 */
export function assembleChangelog(
  packages: PackageChangelog[],
  entries: Omit<Entry, "release">[],
): Changelog {
  const releaseOf = new Map<number, Release>();
  const releases = new Map<string, Release>();
  for (const { source } of packages) {
    for (const [version, pulls] of pullsByVersion(source)) {
      const release = releases.get(version) ?? {
        version,
        tag: `v${version}`,
        url: `${REPOSITORY}/releases/tag/v${version}`,
      };
      releases.set(version, release);
      for (const pull of pulls) {
        const known = releaseOf.get(pull);
        if (!known || lt(version, known.version)) releaseOf.set(pull, release);
      }
    }
  }
  const releaseFor = (pulls: number[]): Release | undefined => {
    const found = pulls.map((pull) => releaseOf.get(pull));
    if (found.length === 0 || found.some((release) => !release)) return undefined;
    return (found as Release[]).sort((a, b) => rcompare(a.version, b.version))[0];
  };
  return {
    entries: entries
      .map((entry) => ({ ...entry, release: releaseFor(entry.pulls) }))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.title.localeCompare(b.title)),
    releases: [...releases.values()].sort((a, b) => rcompare(a.version, b.version)),
  };
}

// A CHANGELOG.md's releases from FIRST_RELEASE on, a `## 0.2.0` heading each,
// and the pull requests their entries name first, as
// @changesets/changelog-github writes them: "- [#2187](…/pull/2187) …".
function pullsByVersion(source: string): Map<string, Set<number>> {
  const found = new Map<string, Set<number>>();
  let pulls: Set<number> | undefined;
  for (const line of source.split(/\r?\n/)) {
    const version = /^## (\S+)\s*$/.exec(line)?.[1];
    if (version) {
      pulls = listed(version) ? (found.get(version) ?? new Set()) : undefined;
      if (pulls) found.set(version, pulls);
      continue;
    }
    const pull = /^- \[#(\d+)\]\(/.exec(line)?.[1];
    if (pull) pulls?.add(Number(pull));
  }
  return found;
}

// A version the changelog lists: a release, not a prerelease, from
// FIRST_RELEASE on.
function listed(version: string): boolean {
  return valid(version) !== null && !prerelease(version) && !lt(version, FIRST_RELEASE);
}

function readIfAny(path: string): string | undefined {
  try {
    return readFileSync(/* turbopackIgnore: true */ path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
