#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const publishableRoots = [
  "apps/cli/",
  "packages/api/",
  "packages/components/",
  "packages/design-tokens/",
  "packages/shared-component-styles/",
  "packages/ui-react/",
  "packages/sdk-core/",
  "packages/sdk-next/",
  "packages/sdk-nuxt/",
];

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
  (file) => file.startsWith(".changeset/") && file.endsWith(".md") && file !== ".changeset/README.md",
);

if (packageChanges.length > 0 && !hasChangeset) {
  console.error("Publishable package changes require a changeset.");
  console.error("");
  console.error("Changed publishable package files:");
  for (const file of packageChanges) {
    console.error(`- ${file}`);
  }
  console.error("");
  console.error("Run `corepack pnpm changeset` and commit the generated .changeset/*.md file.");
  process.exit(1);
}
