#!/usr/bin/env node
import { existsSync } from "node:fs";
import { appendFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun, runCapture } from "./dev-process.mjs";
import { PUBLIC_RELEASE_PACKAGES } from "./release-manifest.mjs";

// Public product packages, mirrored by the fixed alpha group in
// `.changeset/config.json`. `validateFixedGroup()` fails the release check if
// the manifest and Changesets config drift.
export const publicPackages = PUBLIC_RELEASE_PACKAGES.map((pkg) => ({
  name: pkg.name,
  root: `${pkg.dir}/`,
}));

// The console and login UI publish no npm package of their own — they are built
// into the server container, so a user-visible change there ships inside
// `@zitadel/server` and belongs in the release notes. They are deliberately not
// in PUBLIC_RELEASE_PACKAGES or the changesets fixed group: they are never
// packed or published, they only make a changeset mandatory. See
// `.changeset/README.md#when-a-change-needs-a-changeset`.
export const embeddedServerSurfaces = [
  { name: "@zitadel/server", root: "apps/console/" },
  { name: "@zitadel/server", root: "apps/login-ui/" },
];

const publicPackageNames = publicPackages.map((pkg) => pkg.name);
const publicPackageNameSet = new Set(publicPackageNames);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export function parseArgs(args) {
  const parsed = {
    base: "origin/main",
    pending: false,
    summary: false,
    versionPr: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--base requires a value");
      }
      parsed.base = value;
      index += 1;
      continue;
    }
    if (arg === "--summary") {
      parsed.summary = true;
      continue;
    }
    if (arg === "--pending") {
      parsed.pending = true;
      continue;
    }
    if (arg === "--version-pr") {
      parsed.versionPr = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return parsed;
}

export function parseNameStatus(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [rawStatus, ...paths] = line.split("\t");
      const file = normalizePath(paths.at(-1) ?? "");
      if (!rawStatus || !file) {
        throw new Error(`could not parse git diff line: ${line}`);
      }
      return {
        status: rawStatus[0],
        file,
      };
    });
}

export function analyzeChangedEntries(entries, options = {}) {
  const changedFiles = entries.map((entry) => entry.file);
  const currentChangesetFiles = entries
    .filter((entry) => entry.status !== "D" && isChangesetMarkdown(entry.file))
    .map((entry) => entry.file);
  const deletedChangesetFiles = entries
    .filter((entry) => entry.status === "D" && isChangesetMarkdown(entry.file))
    .map((entry) => entry.file);
  const publishableEntries = entries
    .map((entry) => ({ ...entry, pkg: packageForFile(entry.file) }))
    .filter((entry) => entry.pkg);
  const changedPackages = groupPublishableEntries(publishableEntries);
  const versionOutputOnly =
    entries.length > 0 &&
    currentChangesetFiles.length === 0 &&
    entries.every((entry) => isVersionOutputFile(entry.file));
  const versionOnly =
    versionOutputOnly &&
    publishableEntries.length > 0 &&
    (deletedChangesetFiles.length > 0 || options.versionPr === true);

  return {
    changedFiles,
    currentChangesetFiles,
    deletedChangesetFiles,
    publishableEntries,
    changedPackages,
    versionOutputOnly,
    versionOnly,
  };
}

export function isVersionOutputFile(file) {
  return (
    file === "pnpm-lock.yaml" ||
    file === ".changeset/pre.json" ||
    file === ".changeset/config.json" ||
    file.startsWith(".changeset/") ||
    file.endsWith("/package.json") ||
    file.endsWith("/CHANGELOG.md")
  );
}

export function isChangesetMarkdown(file) {
  return file.startsWith(".changeset/") && file.endsWith(".md") && file !== ".changeset/README.md";
}

export function isTestFile(file) {
  // Test files never ship, so mirror the "tests skip" rule in
  // `.changeset/README.md`: a test-only change under a publishable root does not
  // require a changeset.
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    file.endsWith("_test.go") ||
    /(^|\/)(tests?|__tests__)\//.test(file)
  );
}

export function packageForFile(file) {
  if (file.endsWith("/AGENTS.md") || isTestFile(file)) {
    return undefined;
  }

  const publicPackage = publicPackages.find((pkg) => file.startsWith(pkg.root));
  if (publicPackage) {
    return publicPackage;
  }

  // Markdown under an embedded surface is repo documentation — the container
  // ships built output, not these files. An npm package's own README does ship
  // in its tarball, which is why this exemption is scoped to the surfaces below.
  if (file.endsWith(".md")) {
    return undefined;
  }
  return embeddedServerSurfaces.find((surface) => file.startsWith(surface.root));
}

export function parseChangesetPackages(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    return [];
  }

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .flatMap((line) => {
      const packageMatch = line.match(/^["']?([^"':]+)["']?\s*:\s*["']?(major|minor|patch|none)["']?\s*$/);
      return packageMatch ? [packageMatch[1]] : [];
    });
}

export function validateFixedGroup(config) {
  const errors = [];
  if (!Array.isArray(config.fixed)) {
    return ["changesets config must define a fixed group array"];
  }
  if (config.fixed.length !== 1) {
    errors.push(`expected exactly one fixed alpha group, found ${config.fixed.length}`);
  }

  const group = Array.isArray(config.fixed[0]) ? config.fixed[0] : [];
  const missing = publicPackageNames.filter((name) => !group.includes(name));
  const extra = group.filter((name) => !publicPackageNameSet.has(name));
  const duplicates = group.filter((name, index) => group.indexOf(name) !== index);

  if (missing.length > 0) {
    errors.push(`fixed alpha group is missing: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    errors.push(`fixed alpha group contains non-public packages: ${extra.join(", ")}`);
  }
  if (duplicates.length > 0) {
    errors.push(`fixed alpha group contains duplicates: ${[...new Set(duplicates)].join(", ")}`);
  }

  return errors;
}

export async function checkChangesetsStatus(options) {
  const base = options.base ?? "origin/main";
  const pending = options.pending ?? false;
  const versionPr = options.versionPr ?? false;
  const root = options.repoRoot ?? repoRoot;
  const entries = options.entries ?? (pending ? await pendingChangesetEntries(root) : await gitChangedEntries(root, base));
  const config = options.config ?? (await readChangesetsConfig(root));
  const analysis = analyzeChangedEntries(entries, { versionPr });
  const errors = validateFixedGroup(config).map((message) => ({
    code: "fixed-group",
    message,
  }));
  const parsedChangesets = [];
  let changesetStatus = options.changesetStatus;

  if (analysis.currentChangesetFiles.length > 0) {
    const changesetSources =
      options.changesetSources ?? (await readChangesetSources(root, analysis.currentChangesetFiles));

    for (const file of analysis.currentChangesetFiles) {
      const packages = parseChangesetPackages(changesetSources[file] ?? "");
      parsedChangesets.push({ file, packages });
      for (const name of packages) {
        if (!publicPackageNameSet.has(name)) {
          errors.push({
            code: "invalid-changeset-package",
            message: `${file} references ${name}, which is not a public publishable package`,
          });
        }
      }
    }

    const hasPackageChangeset = parsedChangesets.some((changeset) => changeset.packages.length > 0);
    if (
      hasPackageChangeset &&
      !changesetStatus &&
      (pending || !errors.some((error) => error.code === "invalid-changeset-package"))
    ) {
      try {
        changesetStatus = await (options.runChangesetStatus ?? readChangesetStatus)({
          repoRoot: root,
          base,
          pending,
        });
      } catch (error) {
        errors.push({
          code: "changeset-status",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else if (analysis.publishableEntries.length > 0 && !analysis.versionOnly) {
    errors.push({
      code: "missing-changeset",
      message: "publishable package paths changed without a .changeset/*.md file",
    });
  }

  if (changesetStatus) {
    errors.push(...validateChangesetStatusPackages(changesetStatus));
  }

  return {
    ok: errors.length === 0,
    base,
    pending,
    versionPr,
    analysis,
    errors,
    parsedChangesets,
    changesetStatus,
    nextAction: nextAction({ analysis, errors, changesetStatus, pending, parsedChangesets }),
  };
}

export function validateChangesetStatusPackages(status) {
  const errors = [];

  for (const changeset of status.changesets ?? []) {
    for (const release of changeset.releases ?? []) {
      if (!publicPackageNameSet.has(release.name)) {
        errors.push({
          code: "invalid-changeset-package",
          message: `changeset ${changeset.id} references ${release.name}, which is not a public publishable package`,
        });
      }
    }
  }

  for (const release of status.releases ?? []) {
    if (publicPackageNameSet.has(release.name) || release.type === "none") {
      continue;
    }
    errors.push({
      code: "invalid-release-package",
      message: `changeset status planned ${release.type} for ${release.name}, which is not a public publishable package`,
    });
  }

  return errors;
}

export function renderStepSummary(report) {
  const lines = [
    "# Changesets status",
    "",
    `Status: ${report.ok ? "passed" : "failed"}`,
    `Mode: ${report.pending ? "pending changesets" : "diff against base"}`,
    `Version PR: ${report.versionPr ? "yes" : "no"}`,
    ...(report.pending ? [] : [`Base: \`${report.base}\``]),
    "",
    "## Changed publishable paths",
    "",
  ];

  if (report.analysis.changedPackages.length === 0) {
    lines.push("No publishable package paths changed.", "");
  } else {
    lines.push("| Package | Files |", "| --- | --- |");
    for (const changedPackage of report.analysis.changedPackages) {
      const shownFiles = changedPackage.files.slice(0, 12).map((file) => `\`${escapeMarkdown(file)}\``);
      const hiddenCount = changedPackage.files.length - shownFiles.length;
      if (hiddenCount > 0) {
        shownFiles.push(`and ${hiddenCount} more`);
      }
      lines.push(
        `| \`${changedPackage.name}\` | ${shownFiles.join("<br>")} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Changeset files", "");
  if (report.analysis.currentChangesetFiles.length === 0) {
    lines.push("No pending changeset files in the current tree.", "");
  } else {
    for (const file of report.analysis.currentChangesetFiles) {
      lines.push(`- \`${file}\``);
    }
    lines.push("");
  }

  lines.push("## Planned bumps", "");
  const releases = (report.changesetStatus?.releases ?? []).filter(
    (release) => publicPackageNameSet.has(release.name) && release.type !== "none",
  );
  if (releases.length === 0) {
    lines.push("No package bumps planned by Changesets.", "");
  } else {
    lines.push("| Package | Type | Old | New | Changesets |", "| --- | --- | --- | --- | --- |");
    for (const release of releases) {
      lines.push(
        `| \`${release.name}\` | ${release.type} | \`${release.oldVersion ?? ""}\` | \`${release.newVersion ?? ""}\` | ${(release.changesets ?? []).map((id) => `\`${escapeMarkdown(id)}\``).join(", ") || "-"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Next action", "", report.nextAction, "");

  if (report.errors.length > 0) {
    lines.push("## Errors", "");
    for (const error of report.errors) {
      lines.push(`- ${error.message}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export async function main(args = forwardedArgs(), options = {}) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    printUsage();
    return 0;
  }

  const report = await checkChangesetsStatus({
    repoRoot: options.repoRoot ?? repoRoot,
    base: parsed.base,
    pending: parsed.pending,
    versionPr: parsed.versionPr,
    entries: options.entries,
    config: options.config,
    changesetSources: options.changesetSources,
    changesetStatus: options.changesetStatus,
    runChangesetStatus: options.runChangesetStatus,
  });

  const summary = renderStepSummary(report);
  if (parsed.summary) {
    await writeSummary(summary, options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY);
  }

  if (report.ok) {
    console.log(`changesets status: ok - ${report.nextAction}`);
    return 0;
  }

  console.error("changesets status: failed");
  for (const error of report.errors) {
    console.error(`- ${error.message}`);
  }
  return 1;
}

export async function gitChangedEntries(root, base) {
  const committed = await runCapture("git", ["diff", "--name-status", `${base}...HEAD`], { cwd: root });
  const worktree = await runCapture("git", ["diff", "--name-status", "HEAD"], { cwd: root });
  const untracked = await runCapture("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root });
  const entries = new Map();

  for (const entry of parseNameStatus(committed.stdout)) {
    entries.set(entry.file, entry);
  }
  for (const entry of parseNameStatus(worktree.stdout)) {
    entries.set(entry.file, entry);
  }
  for (const file of untracked.stdout.split(/\r?\n/).map(normalizePath).filter(Boolean)) {
    entries.set(file, { status: "A", file });
  }

  return [...entries.values()].sort((left, right) => left.file.localeCompare(right.file));
}

async function pendingChangesetEntries(root) {
  const entries = await readdir(join(root, ".changeset"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isChangesetMarkdown(`.changeset/${entry.name}`))
    .map((entry) => ({ status: "A", file: `.changeset/${entry.name}` }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

async function readChangesetsConfig(root) {
  return JSON.parse(await readFile(join(root, ".changeset/config.json"), "utf8"));
}

async function readChangesetSources(root, files) {
  const sources = {};
  for (const file of files) {
    const path = join(root, file);
    sources[file] = existsSync(path) ? await readFile(path, "utf8") : "";
  }
  return sources;
}

async function readChangesetStatus({ repoRoot: root, base, pending }) {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-changesets-"));
  const output = join(dir, "status.json");
  const args = ["pnpm", "exec", "changeset", "status"];
  if (!pending) {
    args.push("--since", base);
  }
  args.push("--output", output);
  try {
    await runCapture("corepack", args, { cwd: root });
    return JSON.parse(await readFile(output, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`changeset status failed: ${detail}`, { cause: error });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeSummary(summary, summaryPath) {
  if (summaryPath) {
    await appendFile(summaryPath, summary);
    return;
  }
  console.log(summary);
}

function groupPublishableEntries(entries) {
  const groups = [];
  for (const entry of entries) {
    let group = groups.find((item) => item.name === entry.pkg.name);
    if (!group) {
      group = {
        name: entry.pkg.name,
        root: entry.pkg.root,
        files: [],
      };
      groups.push(group);
    }
    group.files.push(entry.file);
  }
  return groups;
}

function nextAction({ analysis, errors, changesetStatus, pending, parsedChangesets }) {
  if (errors.some((error) => error.code === "missing-changeset")) {
    return "Add a real changeset with `corepack pnpm changeset`, or rarely add an empty changeset if no published behavior changes.";
  }
  if (errors.some((error) => error.code === "invalid-changeset-package")) {
    return "Edit the changeset frontmatter so it names only public publishable packages from `.changeset/README.md`.";
  }
  if (errors.some((error) => error.code === "fixed-group")) {
    return "Update `.changeset/config.json` so the fixed alpha group matches the public product package list.";
  }
  if (errors.length > 0) {
    return "Fix the Changesets status errors above, then rerun this check.";
  }
  if (analysis.versionOnly) {
    return "Version PR output detected. Merge after CI is green; release-publish will run automatically from main.";
  }
  if (
    analysis.currentChangesetFiles.length > 0 &&
    parsedChangesets.every((changeset) => changeset.packages.length === 0)
  ) {
    return "Empty changeset is present for non-shipping publishable path changes.";
  }
  if (pending && analysis.currentChangesetFiles.length === 0) {
    return "No pending changesets found.";
  }
  if (analysis.currentChangesetFiles.length > 0 && changesetStatus) {
    return "Changesets are present and Changesets can calculate the planned alpha product bump.";
  }
  return "No changeset required for this diff.";
}

function normalizePath(file) {
  return file.replaceAll("\\", "/");
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|");
}

function printUsage() {
  console.log(`Usage: node scripts/check-changesets-status.mjs [--base <ref>] [--pending] [--version-pr] [--summary]

Checks whether the current diff has valid Changesets coverage for public packages.
Use --pending to validate all current pending .changeset/*.md files before release prepare.
Use --version-pr only for generated Changesets Version Packages PRs.
`);
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
