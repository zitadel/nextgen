#!/usr/bin/env node
// Gate PRs: fail when a PR touches a public npm package without adding a
// changeset, so no consumer-visible change merges without a release note.
//
// Only the public packages are listed here; private workspace packages
// (apps, demos, mocks, lint, design-tokens, ui-react, ...) are never
// published, so they do not require a changeset. For changes that release
// nothing (docs/tests/CI/chores), add an empty changeset:
// `corepack pnpm changeset --empty`.
import { execFileSync } from "node:child_process";

const publishableRoots = [
  "apps/cli/",
  "apps/server/",
  "apps/server-linux-x64/",
  "apps/server-linux-arm64/",
  "apps/server-darwin-x64/",
  "apps/server-darwin-arm64/",
  "apps/server-win32-x64/",
  "packages/api/",
  "packages/components/",
  "packages/sdk-core/",
  "packages/sdk-next/",
  "packages/sdk-nuxt/",
  "packages/sdk-react/",
  "packages/sdk-vue/",
  "packages/sdk-angular/",
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
    "`.changeset/<slug>.md` file directly, see AGENTS.md), then commit it.",
  );
  console.error(
    "For changes that release nothing, use `corepack pnpm changeset --empty`.",
  );
  process.exit(1);
}
