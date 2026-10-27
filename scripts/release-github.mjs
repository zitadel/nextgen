#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { artifactImageRows, artifactPackageRows } from "./release-artifacts.mjs";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
const GITHUB_API_VERSION = "2022-11-28";
const RELEASE_TITLE_PREFIX = "Zitadel NextGen";

// GitHub rejects release bodies longer than this with a 422. JS string
// lengths count UTF-16 units and never undercount characters, so comparing
// `.length` against this limit stays on the safe side.
export const GITHUB_RELEASE_BODY_MAX_CHARS = 125000;

// The website's changelog parses the body back
// (apps/website/app/changelog/releases.ts): change its format there too.
export const GENERATED_BLOCK_START = "<!-- nextgen-release-facts:start -->";
export const GENERATED_BLOCK_END = "<!-- nextgen-release-facts:end -->";
export const PRODUCT_NOTES_PLACEHOLDER =
  "<!-- Maintainers: add human-written product release notes above the generated facts before publishing this draft. -->";

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
    logOmittedChanges(options.log, tag, omitted);
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
    logOmittedChanges(options.log, tag, omitted);
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
  logOmittedChanges(options.log, tag, fitted.omitted);
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

function logOmittedChanges(log, tag, omitted) {
  if (omitted.length === 0) {
    return;
  }
  const counts = BUMPS.map((bump) => [bump, omitted.filter((change) => change.bump === bump)])
    .filter(([, changes]) => changes.length > 0)
    .map(([bump, changes]) => `${changes.length} ${bump}`);
  log?.(
    `omitted ${omitted.length} change(s) from GitHub Release ${tag} to stay under ${GITHUB_RELEASE_BODY_MAX_CHARS} characters: ${counts.join(", ")}`,
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
 * [#123](…) … - Summary". The changes `omitted` leave one line per bump.
 */
export function renderPackageChanges({ metadata, changes, omitted = new Set() }) {
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
        ...(left.length > 0 ? [omittedChangesNotice({ metadata, bump, changes: left })] : []),
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
  const names = new Set(changes.flatMap((change) => change.packages));
  const changelogs = (metadata.packages ?? [])
    .filter((pkg) => names.has(pkg.name))
    .map((pkg) => `\`${pkg.path}/CHANGELOG.md\``);
  const count = changes.length === 1 ? `1 ${bump} change` : `${changes.length} ${bump} changes`;
  return `_${count} omitted to keep this release body under GitHub's ${GITHUB_RELEASE_BODY_MAX_CHARS}-character limit; see ${listOf(changelogs)} at tag \`${releaseTag(metadata)}\`._`;
}

function listOf(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");
}

// Omits changes until `fits(block)` accepts the assembled facts block: patch
// changes before minor ones, and of each bump the longest first, so the most
// changes stay listed for the fewest characters shed. A bump's omitted changes
// leave one line naming the CHANGELOG.md files that hold them. A breaking
// change is never omitted: readers must learn from the release what breaks and
// what to do. `fits: false` in the result means even the block that lists only
// the breaking changes is rejected — the space is consumed outside the block.
export function fitGeneratedReleaseFacts({ metadata, changes, fits }) {
  const omitted = new Set();
  const assemble = () =>
    assembleGeneratedReleaseFacts(metadata, renderPackageChanges({ metadata, changes, omitted }));
  let block = assemble();
  if (fits(block)) {
    return { block, omitted: [], fits: true };
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
    block = assemble();
    if (fits(block)) {
      return { block, omitted: [...omitted], fits: true };
    }
  }

  return { block, omitted: [...omitted], fits: false };
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
