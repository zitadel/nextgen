#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  localRegistryPaths,
  localRegistryPort,
  npmEnvironment,
  startLocalRegistry,
  stopLocalRegistry,
  waitForHttp,
  writeVerdaccioConfig,
  writeVerdaccioNpmrc,
} from "../apps/cli-journey-e2e/scripts/local-registry.mjs";

import { buildSmokeImage, runDeploySmoke } from "./deploy-smoke.mjs";
import { forwardedArgs, isDirectRun } from "./dev-process.mjs";
import { publishNpmTarballs } from "./release-npm.mjs";
import { releaseDir } from "./release-artifacts.mjs";
import { readPublishPlan } from "./release-plan.mjs";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

// The npm rehearsal runs the production tarball-promotion path
// (publishNpmTarballs) against a throwaway local Verdaccio. Only loopback
// registries are acceptable here — anything else would be a real publish.
export function assertLocalRegistryUrl(registryUrl) {
  let parsed;
  try {
    parsed = new URL(registryUrl);
  } catch {
    throw new Error(`npm rehearsal registry must be a URL, got ${registryUrl}`);
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error(
      `npm rehearsal only publishes to a local registry on http://127.0.0.1, got ${registryUrl}`,
    );
  }
}

export async function runNpmRehearsal(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const log = options.log ?? console.log;
  const plan = options.plan ?? (await readPublishPlan(repoRoot));
  if (!plan.shouldPublish) {
    throw new Error(
      `npm rehearsal requires a rehearsal publish plan; got skip (${plan.reason}). ` +
        "Run moon run release:rehearse, which writes it.",
    );
  }

  const registryPort =
    options.registryPort ?? localRegistryPort(`${repoRoot}#npm-rehearsal`, process.env);
  const registryUrl = `http://127.0.0.1:${registryPort}`;
  assertLocalRegistryUrl(registryUrl);

  const workDir = options.workDir ?? (await mkdtemp(join(tmpdir(), "zitadel-npm-rehearsal-")));
  const paths = localRegistryPaths(workDir);
  await mkdir(dirname(paths.verdaccioConfigPath), { recursive: true });
  await mkdir(paths.storagePath, { recursive: true });
  await writeVerdaccioConfig(paths.verdaccioConfigPath, paths.storagePath);
  await writeVerdaccioNpmrc(paths.npmrcPath, registryUrl);

  const start = options.startRegistry ?? startLocalRegistry;
  const stop = options.stopRegistry ?? stopLocalRegistry;
  const wait = options.waitForHttp ?? waitForHttp;
  const publish = options.publishTarballs ?? publishNpmTarballs;

  const registry = await start({ env: process.env, log, paths, registryPort, repoRoot });
  try {
    await wait(`${registryUrl}/-/ping`, "Verdaccio", registry, log);
    const result = await publish({
      repoRoot,
      // The plan is dry for the remote surfaces; against the loopback
      // registry the publish must actually run to rehearse the real path.
      plan: { ...plan, dryRun: false },
      registryUrl,
      tarballsDir: join(releaseDir(repoRoot, plan.version), "npm"),
      env: npmEnvironment(process.env, registryUrl, paths.npmrcPath),
      log,
    });

    const notPublished = result.results.filter((entry) => entry.action !== "published");
    if (notPublished.length > 0) {
      throw new Error(
        "npm rehearsal must publish every tarball to the fresh local registry; " +
          `unexpected results: ${notPublished
            .map((entry) => `${entry.name}@${entry.version} (${entry.action})`)
            .join(", ")}`,
      );
    }
    log(
      `npm rehearsal: published ${result.results.length} packages to ${registryUrl} ` +
        `with dist-tag ${result.distTag}`,
    );
    return result;
  } finally {
    await stop(registry);
    if (!options.workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

export function parseArgs(args) {
  const parsed = { npmRehearsal: false, smoke: false, help: false };
  for (const arg of args) {
    switch (arg) {
      case "--npm-rehearsal":
        parsed.npmRehearsal = true;
        break;
      case "--smoke":
        parsed.smoke = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

export async function main(args = forwardedArgs()) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`usage: node scripts/release-rehearsal.mjs [--npm-rehearsal] [--smoke]

Finalizes the release rehearsal after the release:rehearse task deps ran the
container and GitHub Release surfaces in dry-run mode. With --npm-rehearsal,
also publishes the built tarballs to a throwaway local Verdaccio through the
production npm promotion path. With --smoke, builds a host-platform image
from the built docker context and smokes the compose deployment surface.
`);
    return;
  }

  const plan = await readPublishPlan(defaultRepoRoot);
  if (parsed.npmRehearsal) {
    await runNpmRehearsal({ repoRoot: defaultRepoRoot, plan });
  }
  if (parsed.smoke) {
    const image = await buildSmokeImage({ repoRoot: defaultRepoRoot });
    await runDeploySmoke({ repoRoot: defaultRepoRoot, image });
  }
  console.log(
    `release rehearsal complete for ${plan.version}: ` +
      "artifacts verified, container and GitHub Release surfaces ran dry" +
      (parsed.npmRehearsal ? ", npm publish rehearsed against a local registry" : "") +
      (parsed.smoke ? ", compose deployment smoked" : ""),
  );
}

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error?.code ?? 1);
  }
}
