#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
const GITHUB_API_VERSION = "2022-11-28";
const RELEASE_TITLE_PREFIX = "Zitadel NextGen";

export const GENERATED_BLOCK_START = "<!-- nextgen-release-facts:start -->";
export const GENERATED_BLOCK_END = "<!-- nextgen-release-facts:end -->";
export const PRODUCT_NOTES_PLACEHOLDER =
  "<!-- Maintainers: add human-written product release notes above the generated facts before publishing this draft. -->";

export async function upsertProductGithubRelease(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const metadata = options.metadata ?? (await readReleaseMetadata({ outDir: options.outDir }));
  const generatedBlock =
    options.generatedBlock ?? (await renderGeneratedReleaseFacts({ repoRoot, metadata }));
  const body = createInitialReleaseBody(generatedBlock);
  const tag = releaseTag(metadata);

  if (options.dryRun) {
    options.log?.(`dry run: would create or update draft GitHub Release ${tag}`);
    options.log?.(body);
    return { action: "dry-run", tag, body };
  }

  const github = githubReleaseConfig(options.env ?? process.env, options.fetchImpl ?? globalThis.fetch);
  const existing = await getGithubReleaseByTag({ ...github, tag });

  if (!existing) {
    const created = await createGithubRelease({
      ...github,
      metadata,
      tag,
      body,
    });
    options.log?.(`created draft GitHub Release ${tag}`);
    return { action: "create", tag, release: created, body };
  }

  const updatedBody = upsertGeneratedBlock(existing.body ?? "", generatedBlock);
  const updated = await patchGithubRelease({
    ...github,
    releaseId: existing.id,
    body: updatedBody,
  });
  options.log?.(`updated GitHub Release ${tag} generated facts block`);
  return { action: "update", tag, release: updated, body: updatedBody };
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

  const packageChanges = await renderPackageChanges({ repoRoot, metadata });
  return `${GENERATED_BLOCK_START}
## Generated Release Facts

This section is maintained by release automation. Edit product notes outside this block.

Release commit: \`${metadata.shortCommit ?? metadata.commit ?? "unknown"}\`

### Container Images

| Image | Reference |
|---|---|
${(metadata.imageTags ?? []).map((tag) => `| container | \`${tag}\` |`).join("\n")}

### npm Packages

| Package | Version |
|---|---|
${(metadata.packages ?? []).map((pkg) => `| \`${pkg.name}\` | \`${pkg.version}\` |`).join("\n")}

### Package Changes

${packageChanges}
${GENERATED_BLOCK_END}`;
}

export async function renderPackageChanges(options = {}) {
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

    sections.push(`#### \`${pkg.name}\`\n\n${normalized}`);
  }

  return sections.length > 0
    ? sections.join("\n\n")
    : "_No package-specific changelog entries beyond version or dependency updates._";
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

async function getGithubReleaseByTag(options) {
  const response = await options.fetchImpl(`${options.apiBase}/releases/tags/${encodeURIComponent(options.tag)}`, {
    method: "GET",
    headers: githubHeaders(options.token),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub Release lookup failed: ${await responseText(response)}`);
  }
  return await response.json();
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
