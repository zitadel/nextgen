import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lt, prerelease, rcompare, valid } from "semver";

// The changelog's data, read from the repository when the site builds.
// A release's changes come from the CHANGELOG.md that Changesets writes into
// each published package (the fixed group in .changeset/config.json). It
// writes a changeset's entry into the CHANGELOG.md of every package the
// changeset lists, word for word, so a release here lists the entry once,
// with all of them, as scripts/release-github.mjs does for the GitHub
// Release. Its post, the story told above the changes, is
// apps/website/changelog/<version>.md, written after the release
// (apps/website/skills/zitadel-changelog-post).

const REPOSITORY = "https://github.com/zitadel/nextgen";

/**
 * The first release the changelog lists. The `1.0.0-alpha.N` previews before
 * it are deprecated (docs/adrs/074-preview-releases-on-0x.md); GitHub keeps
 * them.
 */
export const FIRST_RELEASE = "0.1.0";

/** The posts, from the repository's root. */
const POSTS = "apps/website/changelog";

// The server's binaries for each platform, whose CHANGELOG.md says only that
// nothing changed.
const PLATFORM_PACKAGE = /^@zitadel\/server-(?:darwin|linux|win32)-/;

// What a section of a package without changes says.
const NO_CHANGES = "No changes in this release.";

/** A change's semver bump, the highest first. */
export const BUMPS = ["major", "minor", "patch"] as const;
export type Bump = (typeof BUMPS)[number];

export type Link = { label: string; href: string };

export type Change = {
  /** The changeset's summary, Markdown. */
  summary: string;
  /** The highest bump it gives any of its packages. */
  bump: Bump;
  /**
   * Whether a paragraph of its summary starts with `**Breaking:**`, which marks
   * a breaking change that ships as a minor before 1.0.0
   * (docs/adrs/074-preview-releases-on-0x.md).
   */
  markedBreaking: boolean;
  /** The packages it changes, in the fixed group's order. */
  packages: string[];
  /** Its pull request, or its commit when it has none. */
  source?: Link;
  authors: Link[];
};

/** A release's post: when it shipped, and its story, Markdown. */
export type Post = { date: string; notes: string };

export type Release = {
  version: string;
  /** Its git tag, which names its page and its GitHub Release: `v0.2.0`. */
  tag: string;
  /** Its GitHub Release. */
  url: string;
  /** The day it shipped, `2026-10-21`, from its post; none without one. */
  date?: string;
  /** Its post's story, Markdown; empty without one. */
  notes: string;
  changes: Change[];
};

/** A published package's CHANGELOG.md. */
export type Changelog = { name: string; source: string };

// The pages are static: the site reads these files only while it builds, so
// its server functions need none of them. turbopackIgnore keeps Turbopack
// from tracing the whole repository into them for each read below.

/**
 * Every release from FIRST_RELEASE on, the highest version first. `next build`
 * runs in apps/website, two folders below the repository's root.
 */
export function readReleases(
  root = join(/* turbopackIgnore: true */ process.cwd(), "..", ".."),
): Release[] {
  return assembleReleases(readChangelogs(root), readPosts(join(root, POSTS)));
}

/**
 * The published packages' CHANGELOG.md, in the fixed group's order: each one
 * under apps/ or packages/ whose title names a package of the group.
 */
export function readChangelogs(root: string): Changelog[] {
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

/** The posts in a folder, by version: `0.2.0.md` is 0.2.0's. */
export function readPosts(folder: string): Map<string, Post> {
  const files = readdirSync(/* turbopackIgnore: true */ folder).filter((file) =>
    file.endsWith(".md"),
  );
  return new Map(
    files.map((file) => [
      file.slice(0, -".md".length),
      parsePost(file, readFileSync(/* turbopackIgnore: true */ join(folder, file), "utf8")),
    ]),
  );
}

/**
 * A post's front matter, which holds only the day it shipped, and its
 * Markdown. Throws on anything else, so a broken post fails the build.
 */
export function parsePost(file: string, source: string): Post {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) {
    throw new Error(`${file}: a post starts with front matter: ---, date: YYYY-MM-DD, ---`);
  }
  const [, frontMatter = "", notes = ""] = match;
  let date: string | undefined;
  for (const line of frontMatter.split(/\r?\n/).filter((line) => line.trim())) {
    const field = /^date:\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line)?.[1];
    if (!field || Number.isNaN(Date.parse(field))) {
      throw new Error(`${file}: the front matter holds only date: YYYY-MM-DD, not "${line}"`);
    }
    date = field;
  }
  if (!date) throw new Error(`${file}: the front matter has no date: YYYY-MM-DD`);
  return { date, notes: notes.trim() };
}

/**
 * The releases of the packages' changelogs from FIRST_RELEASE on, each change
 * once, with every package it changes and the highest bump any gives it, and
 * each release with its post. Throws on a post for a version no changelog
 * has, such as one merged before its release.
 */
export function assembleReleases(changelogs: Changelog[], posts: Map<string, Post>): Release[] {
  // Keyed by the entry's text with its whitespace collapsed, so an entry a
  // formatter rewrapped in one CHANGELOG.md still names the same change.
  const releases = new Map<string, Map<string, Change>>();
  for (const { name, source } of changelogs) {
    for (const [version, section] of sections(source)) {
      if (!listed(version)) continue;
      const changes = releases.get(version) ?? new Map<string, Change>();
      releases.set(version, changes);
      for (const { text, bump } of entries(section)) {
        const key = text.replace(/\s+/g, " ");
        const known = changes.get(key);
        if (!known) {
          changes.set(key, { ...parseChange(text), bump, packages: [name] });
          continue;
        }
        if (!known.packages.includes(name)) known.packages.push(name);
        if (BUMPS.indexOf(bump) < BUMPS.indexOf(known.bump)) known.bump = bump;
      }
    }
  }
  for (const version of posts.keys()) {
    if (!releases.has(version)) {
      throw new Error(
        `${POSTS}/${version}.md: no published package's CHANGELOG.md has a release ${version} from ${FIRST_RELEASE} on`,
      );
    }
  }
  return [...releases]
    .map(([version, changes]) => ({
      version,
      tag: `v${version}`,
      url: `${REPOSITORY}/releases/tag/v${version}`,
      date: posts.get(version)?.date,
      notes: posts.get(version)?.notes ?? "",
      changes: [...changes.values()],
    }))
    .sort((a, b) => rcompare(a.version, b.version));
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

// A CHANGELOG.md's sections: each `## 0.2.0` heading's version and the lines
// up to the next.
function sections(source: string): [version: string, section: string][] {
  const found: [string, string[]][] = [];
  for (const line of source.split(/\r?\n/)) {
    const version = /^## (\S+)\s*$/.exec(line)?.[1];
    if (version) {
      found.push([version, []]);
    } else {
      found.at(-1)?.[1].push(line);
    }
  }
  return found.map(([version, lines]) => [version, lines.join("\n")]);
}

/**
 * A section's entries: one per list item under a `### Minor Changes` heading
 * (or Major, Patch), without its marker and indent, and one per paragraph
 * outside any item, but the updates of internal dependencies Changesets adds.
 * An item's further lines are indented by two spaces, except where a
 * CHANGELOG.md was rewrapped: a line that continues a paragraph needs no
 * indent in Markdown (a lazy continuation line), so only an unindented one
 * after a blank line ends it.
 */
function entries(section: string): { text: string; bump: Bump }[] {
  const found: { text: string; bump: Bump }[] = [];
  let bump: Bump = "patch";
  let entry: { item: boolean; bump: Bump; lines: string[] } | undefined;
  let afterBlank = true;

  const finish = () => {
    const text = entry?.lines.join("\n").trim();
    if (entry && text && text !== NO_CHANGES) found.push({ text, bump: entry.bump });
    entry = undefined;
  };

  for (const line of withoutDependencyUpdates(section)) {
    const group = /^### (Major|Minor|Patch) Changes\s*$/.exec(line)?.[1];
    const blank = line.trim() === "";
    if (group) {
      finish();
      bump = group.toLowerCase() as Bump;
    } else if (line.startsWith("- ")) {
      finish();
      entry = { item: true, bump, lines: [line.slice(2)] };
    } else if (entry?.item && (blank || line.startsWith("  ") || !afterBlank)) {
      entry.lines.push(blank ? "" : line.replace(/^ {2}/, ""));
    } else if (blank) {
      finish();
    } else {
      if (entry?.item) finish();
      entry ??= { item: false, bump, lines: [] };
      entry.lines.push(line);
    }
    afterBlank = blank;
  }
  finish();
  return found;
}

// A section's lines without the "Updated dependencies" items Changesets
// writes for the internal dependencies a release bumps, and their indented
// lines.
function withoutDependencyUpdates(section: string): string[] {
  const kept: string[] = [];
  let skipping = false;
  for (const line of section.split("\n")) {
    if (/^- Updated dependencies\b/.test(line)) {
      skipping = true;
    } else if (!skipping || !(line.trim() === "" || line.startsWith("  "))) {
      skipping = false;
      kept.push(line);
    }
  }
  return kept;
}

// What @changesets/changelog-github writes before a changeset's summary: its
// pull request, its commit and its authors, each when known, then " - ".
const CHANGE_PREFIX =
  /^(?:\[#(\d+)\]\(([^)\s]+)\) )?(?:\[`([0-9a-f]+)`\]\(([^)\s]+)\) )?(?:Thanks (.+?)! )?- /;

// A paragraph that starts with **Breaking:**, the summary's first or one after
// a blank line.
const BREAKING_MARKER = /(?:^|\n[ \t]*\n)[ \t]*\*\*Breaking:\*\*/;

function parseChange(
  text: string,
): Pick<Change, "summary" | "markedBreaking" | "source" | "authors"> {
  const match = CHANGE_PREFIX.exec(text);
  if (!match || !(match[1] || match[3] || match[5])) {
    return { ...parseSummary(text), authors: [] };
  }
  const [prefix, pull, pullUrl, commit, commitUrl, thanks = ""] = match;
  return {
    ...parseSummary(text.slice(prefix.length)),
    source:
      pull && pullUrl
        ? { label: `#${pull}`, href: pullUrl }
        : commit && commitUrl
          ? { label: commit, href: commitUrl }
          : undefined,
    authors: [...thanks.matchAll(/\[(@[^\]]+)\]\(([^)\s]+)\)/g)].flatMap(([, label, href]) =>
      label && href ? [{ label, href }] : [],
    ),
  };
}

function parseSummary(summary: string): Pick<Change, "summary" | "markedBreaking"> {
  return { summary, markedBreaking: BREAKING_MARKER.test(summary) };
}
