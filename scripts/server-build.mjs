#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectRun, run, runCapture } from "./dev-process.mjs";

export const SERVER_BUILD_PACKAGE = "github.com/zitadel/nextgen/internal/build";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function gitInfo(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const runCaptureFn = options.runCapture ?? runCapture;
  const commit = (
    await runCaptureFn("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  ).stdout.trim();
  const shortCommit = (
    await runCaptureFn("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repoRoot,
    })
  ).stdout.trim();
  const date = (
    await runCaptureFn("git", ["show", "-s", "--format=%cI", "HEAD"], {
      cwd: repoRoot,
    })
  ).stdout.trim();
  return { commit, shortCommit, date };
}

export function serverLdflags({ version, commit, date, strip = false }) {
  const metadata = { version, commit, date };
  for (const [name, value] of Object.entries(metadata)) {
    if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
      throw new Error(`server build ${name} must be a non-empty value without whitespace`);
    }
  }
  return [
    strip ? "-s -w" : undefined,
    `-X ${SERVER_BUILD_PACKAGE}.version=${version}`,
    `-X ${SERVER_BUILD_PACKAGE}.commit=${commit}`,
    `-X ${SERVER_BUILD_PACKAGE}.date=${date}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function localServerVersion(info) {
  return `dev+${info.shortCommit}`;
}

export async function buildLocalServer(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const runFn = options.run ?? run;
  const info = options.gitInfo ?? (await gitInfo({ repoRoot, runCapture: options.runCapture }));
  const version = options.version ?? localServerVersion(info);
  const output = options.output ?? join(repoRoot, "dist/server/nextgen");
  const metadataPath = options.metadataPath ?? join(dirname(output), "metadata.json");

  await mkdir(dirname(output), { recursive: true });
  await runFn(
    "go",
    [
      "build",
      "-trimpath",
      "-ldflags",
      serverLdflags({ version, commit: info.commit, date: info.date }),
      "-o",
      output,
      ".",
    ],
    { cwd: repoRoot, env: { ...process.env, ...(options.env ?? {}) } },
  );

  const metadata = {
    schema_version: 1,
    version,
    commit: info.commit,
    short_commit: info.shortCommit,
    date: info.date,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return { output, metadataPath, metadata };
}

export async function readServerBuildMetadata(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (
    parsed?.schema_version !== 1 ||
    typeof parsed.version !== "string" ||
    parsed.version.length === 0 ||
    typeof parsed.commit !== "string" ||
    typeof parsed.date !== "string"
  ) {
    throw new Error(`invalid server build metadata: ${path}`);
  }
  return parsed;
}

if (isDirectRun(import.meta.url)) {
  try {
    await buildLocalServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
