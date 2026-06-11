#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const execute = process.argv.includes("--execute");
const limit = readLimit(process.argv.slice(2));

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
  const { stdio = "pipe", ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    ...spawnOptions,
    encoding: "utf8",
    stdio,
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.status}`);
  }
  return result;
}

function readLimit(args) {
  const limitIndex = args.indexOf("--limit");
  if (limitIndex < 0) {
    return "200";
  }

  const value = args[limitIndex + 1];
  if (!value || value.startsWith("-") || !/^[1-9]\d*$/.test(value)) {
    usage(`--limit must be followed by a positive integer, got ${JSON.stringify(value)}`);
  }

  return value;
}

function usage(message) {
  console.error(message);
  console.error(
    "usage: node scripts/delete-package-github-releases.mjs [--execute] [--limit <positive-integer>]",
  );
  process.exit(1);
}
