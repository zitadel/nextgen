import { rcompare, valid } from "semver";

// The changelog's data: the repository's GitHub Releases, read back from the
// body the release automation writes (scripts/release-github.mjs). A body
// holds the maintainers' notes, then a generated block whose "Package Changes"
// repeat each package's CHANGELOG.md section, so a change that ships in ten
// packages is listed ten times. Each release here lists it once, with every
// package it changes.

const REPOSITORY = "zitadel/nextgen";

/**
 * How many releases the page lists, newest first; GitHub keeps the rest. The
 * page carries each one's changes twice, as HTML and in React's payload, and
 * five already come to some 120 KB compressed.
 */
export const RELEASE_COUNT = 5;

// The generated block, as scripts/release-github.mjs writes it.
const GENERATED_START = "<!-- nextgen-release-facts:start -->";
const GENERATED_END = "<!-- nextgen-release-facts:end -->";
const PACKAGE_CHANGES = "### Package Changes";

/** A change's semver bump, the highest first. */
export const BUMPS = ["major", "minor", "patch"] as const;
export type Bump = (typeof BUMPS)[number];

export type Link = { label: string; href: string };

export type Change = {
  /** The changeset's summary, Markdown. */
  summary: string;
  /** The highest bump it gives any of its packages. */
  bump: Bump;
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
  /** A package whose changes were left out, or a release without any. */
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

/** The published releases of GitHub's answer, the highest version first. */
export function parseReleases(json: unknown): Release[] {
  if (!Array.isArray(json)) {
    throw new Error("GitHub's answer is not a list of releases");
  }
  return (json as GitHubRelease[])
    .filter((release) => !release.draft)
    .map(parseRelease)
    .sort(newestFirst);
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
    // Without its comments, the placeholder the automation leaves among them.
    notes: notes
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    ...parsePackageChanges(generated ? body.slice(start, end) : ""),
  };
}

/**
 * The block's "Package Changes": a `#### \`@zitadel/x\`` heading per
 * package, a `### Minor Changes` heading per bump, and under it one list item
 * per change. An item's first line is `- ` and the changeset's first line;
 * its further lines are indented by two spaces, except where a CHANGELOG.md
 * was rewrapped: a line that continues a paragraph needs no indent in
 * Markdown (a lazy continuation line), so only one after a blank line ends
 * the item.
 */
function parsePackageChanges(block: string): Pick<Release, "changes" | "notices"> {
  const lines = block.split("\n");
  const from = lines.indexOf(PACKAGE_CHANGES);
  // Keyed by the item's text, which is the same under every package.
  const changes = new Map<string, Change>();
  const notices: Notice[] = [];
  let pkg: string | undefined;
  let bump: Bump = "patch";
  let item: { change: boolean; lines: string[] } | undefined;
  let afterBlank = false;

  const finish = () => {
    const text = item?.lines.join("\n").trim();
    if (text && item?.change) {
      const known = changes.get(text);
      if (known) {
        if (pkg && !known.packages.includes(pkg)) known.packages.push(pkg);
        if (BUMPS.indexOf(bump) < BUMPS.indexOf(known.bump)) known.bump = bump;
      } else {
        changes.set(text, { ...parseChange(text), bump, packages: pkg ? [pkg] : [] });
      }
    } else if (text) {
      notices.push({ package: pkg, text });
    }
    item = undefined;
  };

  for (const line of from === -1 ? [] : lines.slice(from + 1)) {
    const heading = /^#### `([^`]+)`\s*$/.exec(line)?.[1];
    const group = /^### (Major|Minor|Patch) Changes\s*$/.exec(line)?.[1];
    const blank = line.trim() === "";
    if (heading || group) {
      finish();
      if (heading) pkg = heading;
      if (group) bump = group.toLowerCase() as Bump;
    } else if (line.startsWith("- ")) {
      finish();
      item = { change: true, lines: [line.slice(2)] };
    } else if (item?.change && (blank || line.startsWith("  ") || !afterBlank)) {
      item.lines.push(line.startsWith("  ") ? line.slice(2) : line);
    } else if (blank) {
      finish();
    } else {
      // Text outside any item, such as the pointer that stands in for a
      // package's changes when they did not fit the release body.
      if (item?.change) finish();
      item ??= { change: false, lines: [] };
      item.lines.push(line);
    }
    afterBlank = blank;
  }
  finish();

  return { changes: [...changes.values()], notices };
}

// What @changesets/changelog-github writes before a changeset's summary: its
// pull request, its commit and its authors, each when known, then " - ".
const CHANGE_PREFIX =
  /^(?:\[#(\d+)\]\(([^)\s]+)\) )?(?:\[`([0-9a-f]+)`\]\(([^)\s]+)\) )?(?:Thanks (.+?)! )?- /;

function parseChange(text: string): Pick<Change, "summary" | "source" | "authors"> {
  const match = CHANGE_PREFIX.exec(text);
  if (!match || !(match[1] || match[3] || match[5])) {
    return { summary: text, authors: [] };
  }
  const [prefix, pull, pullUrl, commit, commitUrl, thanks = ""] = match;
  return {
    summary: text.slice(prefix.length),
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

// By version, which GitHub's own order does not follow (it lists
// v0.1.0-alpha.9 above alpha.10); a tag that is no version goes last.
function newestFirst(a: Release, b: Release): number {
  const left = valid(a.tag);
  const right = valid(b.tag);
  if (left && right) return rcompare(left, right);
  if (left || right) return left ? -1 : 1;
  return b.publishedAt.localeCompare(a.publishedAt);
}
