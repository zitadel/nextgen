#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function detectCiMode(files) {
  const mode =
    files.length > 0 && files.every(isVersionOutputFile) ? "version-only" : "full";
  // Version PRs always smoke the deployment surface (last gate before the
  // publishing commit); full PRs smoke only when the diff touches it.
  const deploySmoke = mode === "version-only" || files.some(isDeploySurfaceFile);
  return { mode, deploySmoke };
}

export function isVersionOutputFile(file) {
  return file === "pnpm-lock.yaml" ||
    file === ".changeset/pre.json" ||
    file === ".changeset/config.json" ||
    file.startsWith(".changeset/") ||
    file.endsWith("/package.json") ||
    file.endsWith("/CHANGELOG.md");
}

// Files that shape what a release deploys or how it deploys: the Dockerfile,
// the documented compose surface, the release scripts and task graph, and
// the workflows that run them.
export function isDeploySurfaceFile(file) {
  return (
    file === "Dockerfile" ||
    file.startsWith("docs/operations/") ||
    file.startsWith("examples/bootstrap-users/") ||
    (file.startsWith("scripts/release") && file.endsWith(".mjs")) ||
    file === "scripts/deploy-smoke.mjs" ||
    file === "scripts/ci-mode.mjs" ||
    file === "scripts/check-release-graph.mjs" ||
    file.startsWith("tools/release/") ||
    file === ".github/workflows/ci.yml" ||
    file === ".github/workflows/release-publish.yml"
  );
}

function main() {
  const base = process.argv[2] || "origin/main";
  const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const files = result.stdout.split(/\r?\n/).filter(Boolean);
  const { mode, deploySmoke } = detectCiMode(files);

  console.log(`mode=${mode}`);
  console.log(`deploy_smoke=${deploySmoke}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=${mode}\ndeploy_smoke=${deploySmoke}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
