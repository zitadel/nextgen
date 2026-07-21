#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, isDirectRun } from "./dev-process.mjs";
import { PUBLIC_PACKAGE_DIRS } from "./release-manifest.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export async function main(args = forwardedArgs()) {
  const command = args[0];
  switch (command) {
    case "local-dist":
      return await cleanLocalDistArtifacts();
    case "public-package-dist":
      return await cleanPublicPackageDistArtifacts();
    default:
      usage(command ? `unknown release clean command: ${command}` : undefined);
  }
}

export async function cleanPublicPackageDistArtifacts(root = repoRoot) {
  await Promise.all(
    PUBLIC_PACKAGE_DIRS.map((dir) =>
      rm(join(root, dir, "dist"), { recursive: true, force: true }),
    ),
  );
}

export async function cleanLocalDistArtifacts(root = process.cwd()) {
  await rm(join(root, "dist"), { recursive: true, force: true });
}

function usage(error) {
  if (error) {
    console.error(error);
    console.error("");
  }
  console.log("usage: node scripts/release-clean.mjs <local-dist|public-package-dist>");
  process.exit(error ? 1 : 0);
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(typeof error?.code === "number" && error.code !== 0 ? error.code : 1);
  }
}
