#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";
import {
  artifactImageRows,
  artifactPackageRows,
  readReleasePackages,
  readServerRelease,
} from "./release-artifacts.mjs";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
const GITHUB_API_VERSION = "2022-11-28";
const RELEASE_TITLE_PREFIX = "Zitadel NextGen";

// GitHub rejects release bodies longer than this with a 422. JS string
// lengths count UTF-16 units and never undercount characters, so comparing
// `.length` against this limit stays on the safe side.
export const GITHUB_RELEASE_BODY_MAX_CHARS = 125000;

// GitHub rejects pull request bodies longer than this.
export const GITHUB_PULL_REQUEST_BODY_MAX_CHARS = 65536;

export const GENERATED_BLOCK_START = "<!-- nextgen-release-facts:start -->";
export const GENERATED_BLOCK_END = "<!-- nextgen-release-facts:end -->";
export const PRODUCT_NOTES_PLACEHOLDER =
  "<!-- Notes above the generated facts are optional and show on GitHub only: notable changes get entries on the website's changelog, apps/website/changelog/. -->";

// A change's bump, the highest first, as the CHANGELOG.md headings name them.
const BUMPS = ["major", "minor", "patch"];
const BUMP_HEADINGS = { major: "Major Changes", minor: "Minor Changes", patch: "Patch Changes" };

// What @changesets/apply-release-plan writes for a package without changes.
const NO_CHANGES_PLACEHOLDER = "No changes in this release.";

export async function upsertProductGithubRelease(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const metadata = options.metadata ?? (await readReleaseMetadata({ outDir: options.outDir }));
  const changes = await collectReleaseChanges({ repoRoot, metadata });
  const tag = releaseTag(metadata);

  if (options.dryRun) {
    const { body, omitted } = fitInitialReleaseBody({ metadata, changes, tag });
    options.log?.(`dry run: would create or update draft GitHub Release ${tag}`);
    options.log?.(body);
    logOmittedChanges(options.log, `GitHub Release ${tag}`, omitted);
    return { action: "dry-run", tag, body, omittedChanges: omitted };
  }

  const github = githubReleaseConfig(
    options.env ?? process.env,
    options.fetchImpl ?? globalThis.fetch,
  );
  const existing = await findGithubReleaseByTag({ ...github, tag });

  if (!existing) {
    const { body, omitted } = fitInitialReleaseBody({ metadata, changes, tag });
    const created = await createGithubRelease({
      ...github,
      metadata,
      tag,
      body,
    });
    options.log?.(`created draft GitHub Release ${tag}`);
    logOmittedChanges(options.log, `GitHub Release ${tag}`, omitted);
    return { action: "create", tag, release: created, body, omittedChanges: omitted };
  }

  const fitted = fitGeneratedReleaseFacts({
    metadata,
    changes,
    fits: (block) =>
      upsertGeneratedBlock(existing.body ?? "", block).length <= GITHUB_RELEASE_BODY_MAX_CHARS,
  });
  if (!fitted.fits) {
    throw new Error(
      `GitHub Release ${tag} body exceeds ${GITHUB_RELEASE_BODY_MAX_CHARS} characters even with every change but the breaking ones omitted; shorten the product notes above the generated facts block`,
    );
  }
  const updatedBody = upsertGeneratedBlock(existing.body ?? "", fitted.block);
  const updated = await patchGithubRelease({
    ...github,
    releaseId: existing.id,
    body: updatedBody,
  });
  options.log?.(`updated GitHub Release ${tag} generated facts block`);
  logOmittedChanges(options.log, `GitHub Release ${tag}`, fitted.omitted);
  return {
    action: "update",
    tag,
    release: updated,
    body: updatedBody,
    omittedChanges: fitted.omitted,
  };
}

function fitInitialReleaseBody({ metadata, changes, tag }) {
  const fitted = fitGeneratedReleaseFacts({
    metadata,
    changes,
    fits: (block) => createInitialReleaseBody(block).length <= GITHUB_RELEASE_BODY_MAX_CHARS,
  });
  if (!fitted.fits) {
    throw new Error(
      `GitHub Release ${tag} body exceeds ${GITHUB_RELEASE_BODY_MAX_CHARS} characters even with every change but the breaking ones omitted`,
    );
  }
  return { body: createInitialReleaseBody(fitted.block), omitted: fitted.omitted };
}

function logOmittedChanges(log, from, omitted, limit = GITHUB_RELEASE_BODY_MAX_CHARS) {
  if (omitted.length === 0) {
    return;
  }
  const counts = BUMPS.map((bump) => [bump, omitted.filter((change) => change.bump === bump)])
    .filter(([, changes]) => changes.length > 0)
    .map(([bump, changes]) => `${changes.length} ${bump}`);
  log?.(
    `omitted ${omitted.length} change(s) from ${from} to stay under ${limit} characters: ${counts.join(", ")}`,
  );
}

export async function readReleaseMetadata(options = {}) {
  if (!options.outDir) {
    throw new Error("release metadata requires outDir");
  }
  return JSON.parse(await readFile(join(options.outDir, "metadata.json"), "utf8"));
}

export async function renderGeneratedReleaseFacts(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const metadata = options.metadata;
  if (!metadata) {
    throw new Error("release facts require metadata");
  }

  const changes = await collectReleaseChanges({ repoRoot, metadata });
  return assembleGeneratedReleaseFacts(metadata, renderPackageChanges({ metadata, changes }));
}

export function assembleGeneratedReleaseFacts(metadata, packageChanges) {
  return `${GENERATED_BLOCK_START}
## Generated Release Facts

This section is maintained by release automation. Edit product notes outside this block.

Release commit: \`${metadata.shortCommit ?? metadata.commit ?? "unknown"}\`

### Container Images

| Image | Reference |
|---|---|
${artifactImageRows(metadata)}

### npm Packages

| Package | Version |
|---|---|
${artifactPackageRows(metadata)}

### Package Changes

${packageChanges}
${GENERATED_BLOCK_END}`;
}

/**
 * The version pull request's description, from a checkout `changeset version`
 * has just versioned: the release's changes, each once with the packages it
 * ships in, as the GitHub Release will list them. changesets/action's own
 * description repeats a change under every package it ships in and drops every
 * changelog once that passes 60,000 characters. Changes are omitted as for the
 * release body to stay under GitHub's limit for a pull request.
 */
export async function renderVersionPullRequestBody(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const metadata = options.metadata ?? (await readVersionMetadata(repoRoot));
  const changes = await collectReleaseChanges({ repoRoot, metadata });
  const intro = versionPullRequestIntro(releaseTag(metadata));
  const fitted = fitChanges({
    changes,
    render: (omitted) =>
      `${intro}\n\n${renderPackageChanges({
        metadata,
        changes,
        omitted,
        notice: omittedFromVersionPullRequestNotice,
      })}\n`,
    fits: (body) => body.length <= GITHUB_PULL_REQUEST_BODY_MAX_CHARS,
  });
  if (!fitted.fits) {
    throw new Error(
      `the version pull request's description exceeds ${GITHUB_PULL_REQUEST_BODY_MAX_CHARS} characters even with every change but the breaking ones omitted`,
    );
  }
  return { body: fitted.text, omitted: fitted.omitted };
}

// The release `changeset version` left in the checkout: the server's version
// names it, and every public package ships in it (the fixed group).
async function readVersionMetadata(repoRoot) {
  const release = await readServerRelease(repoRoot);
  return {
    version: release.version,
    tag: release.tag,
    packages: await readReleasePackages(repoRoot),
  };
}

function versionPullRequestIntro(tag) {
  return `Merging this pull request releases \`${tag}\`: \`release-publish\` publishes the npm packages and the server container image, and drafts the GitHub Release. Until then, each changeset merged to \`main\` updates it.

Each change is listed once, with the packages it ships in, as the GitHub Release will list it. Every package's \`CHANGELOG.md\` is in the diff.`;
}

/**
 * Every change of the release once, `{ text, bump, packages }`, from the
 * packages' CHANGELOG.md sections for its version, in the order the release
 * lists the packages and each CHANGELOG.md its changes. Changesets writes a
 * changeset's entry into the CHANGELOG.md of every package it lists, word for
 * word, so the entry's text names the change; the change keeps the highest
 * bump any of its packages gives it.
 */
export async function collectReleaseChanges(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  // Keyed by the text with its whitespace collapsed, so an entry a formatter
  // rewrapped in one CHANGELOG.md still names the same change.
  const changes = new Map();
  for (const pkg of options.metadata?.packages ?? []) {
    if (isServerPlatformPackage(pkg.name)) {
      continue;
    }

    const changelog = await readPackageChangelog(repoRoot, pkg.path);
    if (!changelog) {
      continue;
    }

    const section = stripUpdatedDependencyBlocks(extractVersionSection(changelog, pkg.version));
    for (const entry of parseChangelogEntries(section)) {
      const key = entry.text.replace(/\s+/g, " ");
      const known = changes.get(key);
      if (!known) {
        changes.set(key, { ...entry, packages: [pkg.name] });
        continue;
      }
      if (!known.packages.includes(pkg.name)) {
        known.packages.push(pkg.name);
      }
      if (BUMPS.indexOf(entry.bump) < BUMPS.indexOf(known.bump)) {
        known.bump = entry.bump;
      }
    }
  }

  return [...changes.values()];
}

/**
 * The entries of a CHANGELOG.md version section, `{ text, bump }`: one per
 * list item under a `### Minor Changes` heading (or Major, Patch), without its
 * marker and indent, and one per paragraph outside any item. An item's further
 * lines are indented by two spaces, except where a CHANGELOG.md was rewrapped:
 * a line that continues a paragraph needs no indent in Markdown (a lazy
 * continuation line), so only an unindented one after a blank line ends it.
 */
export function parseChangelogEntries(section) {
  const entries = [];
  let bump = "patch";
  let entry;
  let afterBlank = true;

  const finish = () => {
    const text = entry?.lines.join("\n").trim();
    if (text && text !== NO_CHANGES_PLACEHOLDER) {
      entries.push({ text, bump: entry.bump });
    }
    entry = undefined;
  };

  for (const line of section.split(/\r?\n/)) {
    const group = /^### (Major|Minor|Patch) Changes\s*$/.exec(line)?.[1];
    const blank = line.trim() === "";
    if (group) {
      finish();
      bump = group.toLowerCase();
    } else if (line.startsWith("- ")) {
      finish();
      entry = { item: true, bump, lines: [line.slice(2)] };
    } else if (entry?.item && (blank || line.startsWith("  ") || !afterBlank)) {
      entry.lines.push(blank ? "" : line.replace(/^ {2}/, ""));
    } else if (blank) {
      finish();
    } else {
      if (entry?.item) {
        finish();
      }
      entry ??= { item: false, bump, lines: [] };
      entry.lines.push(line);
    }
    afterBlank = blank;
  }
  finish();

  return entries;
}

/**
 * The block's "Package Changes": a `#### Minor Changes` heading per bump, the
 * highest first, and under it a list item per change that names the packages
 * it changes before the changeset's entry, "- `@zitadel/cli`, `@zitadel/server`:
 * [#123](…) … - Summary". The changes `omitted` leave one line per bump, the
 * `notice` (the release body's unless given).
 */
export function renderPackageChanges({
  metadata,
  changes,
  omitted = new Set(),
  notice = omittedChangesNotice,
}) {
  const groups = BUMPS.flatMap((bump) => {
    const ofBump = changes.filter((change) => change.bump === bump);
    if (ofBump.length === 0) {
      return [];
    }
    const left = ofBump.filter((change) => omitted.has(change));
    return [
      [
        `#### ${BUMP_HEADINGS[bump]}`,
        ...ofBump.filter((change) => !omitted.has(change)).map(renderChange),
        ...(left.length > 0 ? [notice({ metadata, bump, changes: left })] : []),
      ].join("\n\n"),
    ];
  });
  return groups.length > 0
    ? groups.join("\n\n")
    : "_No package-specific changelog entries beyond version or dependency updates._";
}

function renderChange(change) {
  const [first, ...rest] = change.text.split("\n");
  const packages = change.packages.map((name) => `\`${name}\``).join(", ");
  return [`- ${packages}: ${first}`, ...rest.map((line) => (line ? `  ${line}` : ""))].join("\n");
}

function omittedChangesNotice({ metadata, bump, changes }) {
  return `_${countOf(bump, changes)} omitted to keep this release body under GitHub's ${GITHUB_RELEASE_BODY_MAX_CHARS}-character limit; see ${changelogsOf(metadata, changes)} at tag \`${releaseTag(metadata)}\`._`;
}

function omittedFromVersionPullRequestNotice({ metadata, bump, changes }) {
  return `_${countOf(bump, changes)} omitted to keep this description under GitHub's ${GITHUB_PULL_REQUEST_BODY_MAX_CHARS}-character limit; see ${changelogsOf(metadata, changes)} in this pull request._`;
}

function countOf(bump, changes) {
  return changes.length === 1 ? `1 ${bump} change` : `${changes.length} ${bump} changes`;
}

// The CHANGELOG.md files that hold `changes`, as prose.
function changelogsOf(metadata, changes) {
  const names = new Set(changes.flatMap((change) => change.packages));
  return listOf(
    (metadata.packages ?? [])
      .filter((pkg) => names.has(pkg.name))
      .map((pkg) => `\`${pkg.path}/CHANGELOG.md\``),
  );
}

function listOf(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");
}

// The facts block with as many changes as `fits(block)` accepts (`fitChanges`).
// `fits: false` in the result means even the block that lists only the
// breaking changes is rejected — the space is consumed outside the block.
export function fitGeneratedReleaseFacts({ metadata, changes, fits }) {
  const { text, ...fitted } = fitChanges({
    changes,
    fits,
    render: (omitted) =>
      assembleGeneratedReleaseFacts(metadata, renderPackageChanges({ metadata, changes, omitted })),
  });
  return { block: text, ...fitted };
}

// Omits changes until `fits(text)` accepts `render(omitted)`: patch changes
// before minor ones, and of each bump the longest first, so the most changes
// stay listed for the fewest characters shed. A bump's omitted changes leave
// one line naming the CHANGELOG.md files that hold them. A breaking change is
// never omitted: readers must learn from the release what breaks and what to
// do, so `fits: false` means even the text with only those was rejected.
function fitChanges({ changes, render, fits }) {
  const omitted = new Set();
  let text = render(omitted);
  if (fits(text)) {
    return { text, omitted: [], fits: true };
  }

  const candidates = changes
    .map((change, index) => ({ change, index, size: renderChange(change).length }))
    .filter(({ change }) => !isBreaking(change))
    .sort(
      (a, b) =>
        BUMPS.indexOf(b.change.bump) - BUMPS.indexOf(a.change.bump) ||
        b.size - a.size ||
        a.index - b.index,
    );
  for (const { change } of candidates) {
    omitted.add(change);
    text = render(omitted);
    if (fits(text)) {
      return { text, omitted: [...omitted], fits: true };
    }
  }

  return { text, omitted: [...omitted], fits: false };
}

// A major, or a change whose entry says **Breaking:**, the way a breaking
// change ships as a minor before 1.0.0 (.changeset/README.md#preview-versions).
// Any mention counts, where the website marks only a paragraph that starts with
// it: keeping a change costs characters, omitting a breaking one costs readers.
function isBreaking(change) {
  return change.bump === "major" || change.text.includes("**Breaking:**");
}

export function extractVersionSection(source, version) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) {
    return "";
  }

  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  const end = next === -1 ? lines.length : next;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

export function upsertGeneratedBlock(existingBody, generatedBlock) {
  const start = existingBody.indexOf(GENERATED_BLOCK_START);
  const end = existingBody.indexOf(GENERATED_BLOCK_END);

  if (start === -1 && end === -1) {
    const trimmed = existingBody.trimEnd();
    return trimmed ? `${trimmed}\n\n${generatedBlock}` : createInitialReleaseBody(generatedBlock);
  }

  if (start === -1 || end === -1 || end < start) {
    throw new Error("existing GitHub Release body has a malformed generated facts block");
  }

  const afterEnd = end + GENERATED_BLOCK_END.length;
  return `${existingBody.slice(0, start)}${generatedBlock}${existingBody.slice(afterEnd)}`;
}

export function createInitialReleaseBody(generatedBlock) {
  return `${PRODUCT_NOTES_PLACEHOLDER}\n\n${generatedBlock}`;
}

function stripUpdatedDependencyBlocks(section) {
  const lines = section.split(/\r?\n/);
  const kept = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^- Updated dependencies\b/.test(line.trim())) {
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() === "" || next.startsWith("  ")) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function readPackageChangelog(repoRoot, packagePath) {
  try {
    return await readFile(join(repoRoot, packagePath, "CHANGELOG.md"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function isServerPlatformPackage(name) {
  return /^@zitadel\/server-(?:darwin|linux|win32)-/.test(name);
}

function releaseTag(metadata) {
  return metadata.tag ?? `v${metadata.version}`;
}

function githubReleaseConfig(env, fetchImpl) {
  const missing = [];
  if (!env.GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
  if (!env.GITHUB_REPOSITORY) missing.push("GITHUB_REPOSITORY");
  if (!env.GITHUB_SHA) missing.push("GITHUB_SHA");
  if (missing.length > 0) {
    throw new Error(`GitHub Release creation requires ${missing.join(", ")}`);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("GitHub Release creation requires fetch");
  }

  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPOSITORY must be owner/repo, got ${env.GITHUB_REPOSITORY}`);
  }

  return {
    apiBase: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    fetchImpl,
    sha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
  };
}

async function findGithubReleaseByTag(options) {
  let page = 1;
  while (true) {
    const response = await options.fetchImpl(
      `${options.apiBase}/releases?per_page=100&page=${page}`,
      {
        method: "GET",
        headers: githubHeaders(options.token),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub Release lookup failed: ${await responseText(response)}`);
    }

    const releases = await response.json();
    if (!Array.isArray(releases)) {
      throw new Error("GitHub Release lookup failed: expected an array response");
    }

    const match = releases.find((release) => release?.tag_name === options.tag);
    if (match) {
      return match;
    }
    if (releases.length < 100) {
      return null;
    }
    page += 1;
  }
}

async function createGithubRelease(options) {
  const response = await options.fetchImpl(`${options.apiBase}/releases`, {
    method: "POST",
    headers: githubHeaders(options.token),
    body: JSON.stringify({
      tag_name: options.tag,
      target_commitish: options.sha,
      name: `${RELEASE_TITLE_PREFIX} ${options.tag}`,
      body: options.body,
      draft: true,
      prerelease: options.metadata.version.includes("-"),
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub Release creation failed: ${await responseText(response)}`);
  }
  return await response.json();
}

async function patchGithubRelease(options) {
  const response = await options.fetchImpl(`${options.apiBase}/releases/${options.releaseId}`, {
    method: "PATCH",
    headers: githubHeaders(options.token),
    body: JSON.stringify({ body: options.body }),
  });
  if (!response.ok) {
    throw new Error(`GitHub Release update failed: ${await responseText(response)}`);
  }
  return await response.json();
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": GITHUB_API_VERSION,
  };
}

async function responseText(response) {
  const text = await response.text();
  return `${response.status} ${response.statusText ?? ""}${text ? ` ${text}` : ""}`.trim();
}

export async function main(args = forwardedArgs(), options = {}) {
  if (args[0] !== "version-pr-body" || args.length > 1) {
    console.error(`Usage: node scripts/release-github.mjs version-pr-body

Prints the version pull request's description for a checkout \`changeset version\` has just versioned.`);
    return 1;
  }

  const { body, omitted } = await renderVersionPullRequestBody(options);
  logOmittedChanges(
    console.error,
    "the version pull request's description",
    omitted,
    GITHUB_PULL_REQUEST_BODY_MAX_CHARS,
  );
  process.stdout.write(body);
  return 0;
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
