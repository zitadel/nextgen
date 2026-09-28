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

export const GENERATED_BLOCK_START = "<!-- nextgen-release-facts:start -->";
export const GENERATED_BLOCK_END = "<!-- nextgen-release-facts:end -->";
export const PRODUCT_NOTES_PLACEHOLDER =
  "<!-- Maintainers: add human-written product release notes above the generated facts before publishing this draft. -->";

export async function upsertProductGithubRelease(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const metadata = options.metadata ?? (await readReleaseMetadata({ outDir: options.outDir }));
  const sections = await collectPackageChangeSections({ repoRoot, metadata });
  const tag = releaseTag(metadata);

  if (options.dryRun) {
    const { body, omitted } = fitInitialReleaseBody({ metadata, sections, tag });
    options.log?.(`dry run: would create or update draft GitHub Release ${tag}`);
    options.log?.(body);
    logOmittedPackageChanges(options.log, tag, omitted);
    return { action: "dry-run", tag, body, omittedPackages: omitted };
  }

  const github = githubReleaseConfig(options.env ?? process.env, options.fetchImpl ?? globalThis.fetch);
  const existing = await findGithubReleaseByTag({ ...github, tag });

  if (!existing) {
    const { body, omitted } = fitInitialReleaseBody({ metadata, sections, tag });
    const created = await createGithubRelease({
      ...github,
      metadata,
      tag,
      body,
    });
    options.log?.(`created draft GitHub Release ${tag}`);
    logOmittedPackageChanges(options.log, tag, omitted);
    return { action: "create", tag, release: created, body, omittedPackages: omitted };
  }

  const fitted = fitGeneratedReleaseFacts({
    metadata,
    sections,
    fits: (block) => upsertGeneratedBlock(existing.body ?? "", block).length <= GITHUB_RELEASE_BODY_MAX_CHARS,
  });
  if (!fitted.fits) {
    throw new Error(
      `GitHub Release ${tag} body exceeds ${GITHUB_RELEASE_BODY_MAX_CHARS} characters even with every package changelog omitted; shorten the product notes above the generated facts block`,
    );
  }
  const updatedBody = upsertGeneratedBlock(existing.body ?? "", fitted.block);
  const updated = await patchGithubRelease({
    ...github,
    releaseId: existing.id,
    body: updatedBody,
  });
  options.log?.(`updated GitHub Release ${tag} generated facts block`);
  logOmittedPackageChanges(options.log, tag, fitted.omitted);
  return { action: "update", tag, release: updated, body: updatedBody, omittedPackages: fitted.omitted };
}

function fitInitialReleaseBody({ metadata, sections, tag }) {
  const fitted = fitGeneratedReleaseFacts({
    metadata,
    sections,
    fits: (block) => createInitialReleaseBody(block).length <= GITHUB_RELEASE_BODY_MAX_CHARS,
  });
  if (!fitted.fits) {
    throw new Error(
      `GitHub Release ${tag} body exceeds ${GITHUB_RELEASE_BODY_MAX_CHARS} characters even with every package changelog omitted`,
    );
  }
  return { body: createInitialReleaseBody(fitted.block), omitted: fitted.omitted };
}

function logOmittedPackageChanges(log, tag, omitted) {
  if (omitted.length === 0) {
    return;
  }
  log?.(
    `omitted ${omitted.length} package changelog section(s) from GitHub Release ${tag} to stay under ${GITHUB_RELEASE_BODY_MAX_CHARS} characters: ${omitted.join(", ")}`,
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

  const sections = await collectPackageChangeSections({ repoRoot, metadata });
  return assembleGeneratedReleaseFacts(metadata, sections.map(renderPackageChangeSection));
}

export function assembleGeneratedReleaseFacts(metadata, renderedSections) {
  const packageChanges =
    renderedSections.length > 0
      ? renderedSections.join("\n\n")
      : "_No package-specific changelog entries beyond version or dependency updates._";
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

export async function collectPackageChangeSections(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const sections = [];
  for (const pkg of options.metadata?.packages ?? []) {
    if (isServerPlatformPackage(pkg.name)) {
      continue;
    }

    const changelog = await readPackageChangelog(repoRoot, pkg.path);
    if (!changelog) {
      continue;
    }

    const versionSection = extractVersionSection(changelog, pkg.version);
    const normalized = normalizeChangelogSection(versionSection);
    if (!normalized) {
      continue;
    }

    sections.push({ name: pkg.name, path: pkg.path, content: normalized });
  }

  return sections;
}

export function renderPackageChangeSection(section) {
  return `#### \`${section.name}\`\n\n${section.content}`;
}

// Replaces the largest package changelog sections with pointers to their
// CHANGELOG.md files until `fits(block)` accepts the assembled facts block.
// Dropping largest-first keeps the most sections intact for the fewest
// characters shed. `fits: false` in the result means even a fully stubbed
// block is rejected — the space is consumed outside the generated block.
export function fitGeneratedReleaseFacts({ metadata, sections, fits }) {
  const rendered = sections.map(renderPackageChangeSection);
  let block = assembleGeneratedReleaseFacts(metadata, rendered);
  if (fits(block)) {
    return { block, omitted: [], fits: true };
  }

  const bySizeDesc = sections
    .map((section, index) => ({ index, size: rendered[index].length }))
    .sort((a, b) => b.size - a.size || a.index - b.index);

  const omitted = [];
  for (const { index } of bySizeDesc) {
    const stub = omittedPackageChangeStub(sections[index], metadata);
    if (stub.length >= rendered[index].length) {
      // Sections are visited largest-first, so every remaining section is
      // already smaller than its stub and omitting it cannot shrink the block.
      break;
    }
    rendered[index] = stub;
    omitted.push(sections[index].name);
    block = assembleGeneratedReleaseFacts(metadata, rendered);
    if (fits(block)) {
      return { block, omitted, fits: true };
    }
  }

  return { block, omitted, fits: false };
}

export function omittedPackageChangeStub(section, metadata) {
  return `#### \`${section.name}\`\n\n_Changelog omitted to keep this release body under GitHub's ${GITHUB_RELEASE_BODY_MAX_CHARS}-character limit; see \`${section.path}/CHANGELOG.md\` at tag \`${releaseTag(metadata)}\`._`;
}

export function extractVersionSection(source, version) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) {
    return "";
  }

  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  const end = next === -1 ? lines.length : next;
  return lines.slice(start + 1, end).join("\n").trim();
}

export function normalizeChangelogSection(section) {
  const withoutDependencies = stripUpdatedDependencyBlocks(section);
  const groups = splitChangelogGroups(withoutDependencies);
  const kept = groups.map((group) => group.trim()).filter(hasMeaningfulChangelogContent);
  return kept.join("\n\n").trim();
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

function splitChangelogGroups(section) {
  const groups = [];
  let current = [];

  for (const line of section.split(/\r?\n/)) {
    if (/^###\s+/.test(line) && current.length > 0) {
      groups.push(current.join("\n"));
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    groups.push(current.join("\n"));
  }

  return groups;
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

function hasMeaningfulChangelogContent(section) {
  return section.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !/^###\s+/.test(trimmed);
  });
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
    const response = await options.fetchImpl(`${options.apiBase}/releases?per_page=100&page=${page}`, {
      method: "GET",
      headers: githubHeaders(options.token),
    });
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
