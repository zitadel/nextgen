#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const execute = process.argv.includes("--execute");
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex >= 0 ? process.argv[limitIndex + 1] : "200";

const releases = JSON.parse(
  run("gh", [
    "release",
    "list",
    "--json",
    "tagName,name",
    "--limit",
    limit,
  ]).stdout,
);

const packageReleases = releases.filter((release) => release.tagName?.startsWith("@zitadel/"));
if (packageReleases.length === 0) {
  console.log("No @zitadel/* GitHub package releases found.");
  process.exit(0);
}

for (const release of packageReleases) {
  const label = `${release.tagName}${release.name ? ` (${release.name})` : ""}`;
  if (!execute) {
    console.log(`[dry-run] would delete GitHub release ${label}`);
    continue;
  }
  run("gh", ["release", "delete", release.tagName, "--yes"], { stdio: "inherit" });
  console.log(`Deleted GitHub release ${label}`);
}

if (!execute) {
  console.log("Rerun with --execute to delete these GitHub Releases. Git tags are kept.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.status}`);
  }
  return result;
}
