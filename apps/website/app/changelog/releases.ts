import { lt, rcompare, valid } from "semver";

// The changelog's data: the repository's GitHub Releases, read back from the
// body the release automation writes (scripts/release-github.mjs). A body
// holds the maintainers' notes, then a generated block whose "Package Changes"
// list each change once, with every package it changes. Up to 0.1.0 they
// repeated each package's CHANGELOG.md section instead, so a change that
// ships in ten packages is listed ten times there; each release here lists it
// once.

const REPOSITORY = "zitadel/nextgen";

/**
 * How many releases the page lists, newest first; GitHub keeps the rest. The
 * page carries each one's changes twice, as HTML and in React's payload, and
 * five already come to some 120 KB compressed.
 */
export const RELEASE_COUNT = 5;

/**
 * The first release the page lists. The `0.1.0-alpha.N` previews before it are
 * deprecated (docs/adrs/074-preview-releases-on-0x.md); GitHub keeps them.
 */
export const FIRST_RELEASE = "0.1.0";

// The generated block and the placeholder for the notes above it, as
// scripts/release-github.mjs writes them.
const GENERATED_START = "<!-- nextgen-release-facts:start -->";
const GENERATED_END = "<!-- nextgen-release-facts:end -->";
const PACKAGE_CHANGES = "### Package Changes";
const NOTES_PLACEHOLDER =
  "<!-- Maintainers: add human-written product release notes above the generated facts before publishing this draft. -->";

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
  /** The packages it changes, in the order the release lists them. */
  packages: string[];
  /** Its pull request, or its commit when it has none. */
  source?: Link;
  authors: Link[];
};

/** A paragraph of the package changes that is no change, Markdown. */
export type Notice = { package?: string; text: string };

export type Release = {
  tag: string;
  url: string;
  publishedAt: string;
  /** What the maintainers wrote around the generated block, Markdown. */
  notes: string;
  changes: Change[];
  /** Changes left out of the release body, or a release without any. */
  notices: Notice[];
};

/** The fields this page reads of GitHub's release object. */
export type GitHubRelease = {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  body?: string | null;
};

/**
 * The newest releases from GitHub's API. Throws when GitHub does not answer
 * with them: the page decides what a failure shows (page.tsx).
 *
 * The API allows 60 requests an hour without a token, counted per IP address,
 * and Vercel's are shared; `WEBSITE_GITHUB_TOKEN`, a token without any
 * permission, raises that to 5,000.
 */
export async function fetchReleases(token = process.env.WEBSITE_GITHUB_TOKEN): Promise<Release[]> {
  const url = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=${RELEASE_COUNT}`;
  const response = await fetch(url, {
    // The page is the cache. Next would otherwise keep the answer a build
    // fetched in .next/cache, which Vercel's build cache hands the next build.
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${url} with ${response.status} ${response.statusText}`);
  }
  return parseReleases(await response.json());
}

/** The published releases of GitHub's answer from FIRST_RELEASE on, the highest version first. */
export function parseReleases(json: unknown): Release[] {
  if (!Array.isArray(json)) {
    throw new Error("GitHub's answer is not a list of releases");
  }
  return (json as GitHubRelease[])
    .filter((release) => !release.draft && !beforeFirstRelease(release.tag_name))
    .map(parseRelease)
    .sort(newestFirst);
}

// A tag that is no version stays, as newestFirst places it last.
function beforeFirstRelease(tag: string): boolean {
  const version = valid(tag);
  return version !== null && lt(version, FIRST_RELEASE);
}

export function parseRelease(release: GitHubRelease): Release {
  const body = (release.body ?? "").replace(/\r\n?/g, "\n");
  const start = body.indexOf(GENERATED_START);
  const end = body.indexOf(GENERATED_END);
  const generated = start !== -1 && end > start;
  const notes = generated
    ? `${body.slice(0, start)}\n\n${body.slice(end + GENERATED_END.length)}`
    : body;
  return {
    tag: release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at ?? "",
    // Without the placeholder, so a release nobody wrote notes for has none.
    // This is no sanitizing: the page drops any HTML a note holds
    // (markdown.tsx), comments included.
    notes: notes
      .replaceAll(NOTES_PLACEHOLDER, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    ...parsePackageChanges(generated ? body.slice(start, end) : ""),
  };
}

/**
 * The block's "Package Changes": a `#### Minor Changes` heading per bump, and
 * under it one list item per change. An item's first line is `- `, the
 * packages it changes and a colon, then the changeset's first line:
 * "- `@zitadel/cli`, `@zitadel/server`: [#123](…) … - Summary". Its further
 * lines are indented by two spaces.
 *
 * Up to 0.1.0 a `#### \`@zitadel/x\`` heading per package names the packages
 * instead, each with a `### Minor Changes` heading per bump and its own copy
 * of the item; a change keeps every package and its highest bump. There, a
 * line may lack the indent where a CHANGELOG.md was rewrapped: a line that
 * continues a paragraph needs none in Markdown (a lazy continuation line), so
 * only one after a blank line ends the item.
 */
function parsePackageChanges(block: string): Pick<Release, "changes" | "notices"> {
  const lines = block.split("\n");
  const from = lines.indexOf(PACKAGE_CHANGES);
  // Keyed by the item's text, which is the same under every package.
  const changes = new Map<string, Change>();
  const notices: Notice[] = [];
  let pkg: string | undefined;
  let bump: Bump = "patch";
  let item: { change: boolean; packages: string[]; lines: string[] } | undefined;
  let afterBlank = false;

  const finish = () => {
    const text = item?.lines.join("\n").trim();
    if (text && item?.change) {
      const known = changes.get(text);
      if (known) {
        for (const name of item.packages) {
          if (!known.packages.includes(name)) known.packages.push(name);
        }
        if (BUMPS.indexOf(bump) < BUMPS.indexOf(known.bump)) known.bump = bump;
      } else {
        changes.set(text, { ...parseChange(text), bump, packages: item.packages });
      }
    } else if (text) {
      notices.push({ package: pkg, text });
    }
    item = undefined;
  };

  for (const line of from === -1 ? [] : lines.slice(from + 1)) {
    const heading = /^#### `([^`]+)`\s*$/.exec(line)?.[1];
    const group = /^####? (Major|Minor|Patch) Changes\s*$/.exec(line)?.[1];
    const blank = line.trim() === "";
    if (heading || group) {
      finish();
      if (heading) pkg = heading;
      if (group) bump = group.toLowerCase() as Bump;
    } else if (line.startsWith("- ")) {
      finish();
      // An item under a package's heading names no packages of its own.
      const named = pkg ? null : PACKAGES.exec(line.slice(2));
      item = {
        change: true,
        packages: named?.[1] ? named[1].slice(1, -1).split("`, `") : pkg ? [pkg] : [],
        lines: [line.slice(2 + (named?.[0].length ?? 0))],
      };
    } else if (item?.change && (blank || line.startsWith("  ") || !afterBlank)) {
      item.lines.push(line.startsWith("  ") ? line.slice(2) : line);
    } else if (blank) {
      finish();
    } else {
      // Text outside any item, such as the line that stands in for changes
      // that did not fit the release body.
      if (item?.change) finish();
      item ??= { change: false, packages: [], lines: [] };
      item.lines.push(line);
    }
    afterBlank = blank;
  }
  finish();

  return { changes: [...changes.values()], notices };
}

// The packages before an item's colon, "`@zitadel/cli`, `@zitadel/server`: ".
const PACKAGES = /^((?:`[^`\s]+`, )*`[^`\s]+`): /;

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

// By version, which GitHub's own order does not follow (it lists
// v0.1.0-alpha.9 above alpha.10); a tag that is no version goes last.
function newestFirst(a: Release, b: Release): number {
  const left = valid(a.tag);
  const right = valid(b.tag);
  if (left && right) return rcompare(left, right);
  if (left || right) return left ? -1 : 1;
  return b.publishedAt.localeCompare(a.publishedAt);
}
