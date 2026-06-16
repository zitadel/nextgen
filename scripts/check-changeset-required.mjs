#!/usr/bin/env node
// Gate PRs: fail when a PR touches a public npm package path without adding a
// changeset file, so no consumer-visible change merges without a release note.
//
// Only the public packages are listed here; private workspace packages
// (apps, demos, mocks, lint, design-tokens, ui-react, ...) are never
// published. PRs that do not touch these paths need no changeset at all.
// If a publishable path changes but nothing should ship, add an empty
// changeset: `corepack pnpm changeset --empty` (rare).
import { execFileSync } from "node:child_process";

const publishableRoots = [
  "apps/cli/",
  "packages/api/",
  "packages/components/",
  "packages/sdk-core/",
  "packages/sdk-next/",
  "packages/sdk-nuxt/",
  "packages/sdk-react/",
  "packages/sdk-vue/",
  "packages/sdk-angular/",
  "packages/sdk-solid/",
  "packages/sdk-svelte/",
  "packages/sdk-qwik/",
];

// Files under a publishable package that never ship to npm and so should not
// require a changeset on their own.
const ignoredSuffixes = ["/AGENTS.md"];

const baseArgIndex = process.argv.indexOf("--base");
const base = baseArgIndex >= 0 ? process.argv[baseArgIndex + 1] : "origin/main";
if (!base) {
  throw new Error("Missing value after --base");
}

const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  encoding: "utf8",
});
const changedFiles = output.split("\n").filter(Boolean);

const packageChanges = changedFiles.filter((file) => {
  if (ignoredSuffixes.some((suffix) => file.endsWith(suffix))) {
    return false;
  }
  return publishableRoots.some((root) => file.startsWith(root));
});

const hasChangeset = changedFiles.some(
  (file) =>
    file.startsWith(".changeset/") &&
    file.endsWith(".md") &&
    file !== ".changeset/README.md",
);

if (packageChanges.length > 0 && !hasChangeset) {
  console.error("Publishable package changes require a changeset.");
  console.error("");
  console.error("Changed publishable package files:");
  for (const file of packageChanges) {
    console.error(`- ${file}`);
  }
  console.error("");
  console.error(
    "Run `corepack pnpm changeset` to describe the release (or write the",
  );
  console.error(
    "`.changeset/<slug>.md` file directly, see .changeset/README.md), then commit it.",
  );
  console.error(
    "For publishable-path-only changes that ship nothing, use",
  );
  console.error("`corepack pnpm changeset --empty` (rare). See .changeset/README.md.");
  process.exit(1);
}
