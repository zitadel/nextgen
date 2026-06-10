#!/usr/bin/env node
// Gate PRs: fail when a PR touches a public npm package or runtime/API release
// surface without adding a changeset, so no consumer-visible change merges
// without a release note.
//
// Package changes should mention the changed package. Runtime/API/product
// changes should mention the private @zitadel/product package. For changes
// that release nothing (docs/tests/CI/chores), add an empty changeset:
// `corepack pnpm changeset --empty`.
import { execFileSync } from "node:child_process";

const releaseNoteRoots = [
  "apps/cli/",
  "packages/product/",
  "packages/api/",
  "packages/components/",
  "packages/sdk-core/",
  "packages/sdk-next/",
  "packages/sdk-nuxt/",
  "packages/sdk-react/",
  "packages/sdk-vue/",
  "packages/sdk-angular/",
  "api/openapi/",
  "cmd/",
  "internal/",
  "Dockerfile",
  ".goreleaser.yaml",
];

// Files under release-surface roots that never ship to users and so should not
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

const releaseSurfaceChanges = changedFiles.filter((file) => {
  if (ignoredSuffixes.some((suffix) => file.endsWith(suffix))) {
    return false;
  }
  return releaseNoteRoots.some((root) => file === root || file.startsWith(root));
});

const hasChangeset = changedFiles.some(
  (file) =>
    file.startsWith(".changeset/") &&
    file.endsWith(".md") &&
    file !== ".changeset/README.md",
);

if (releaseSurfaceChanges.length > 0 && !hasChangeset) {
  console.error("Release-surface changes require a changeset.");
  console.error("");
  console.error("Changed release-surface files:");
  for (const file of releaseSurfaceChanges) {
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
