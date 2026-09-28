#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir as systemTmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectRun, run, runCapture } from "./dev-process.mjs";
import {
  buildContainerImage,
  buildServerBinaries,
  gitInfo,
  prepareDockerContext,
  readServerRelease,
} from "./release-artifacts.mjs";
import { localServerVersion } from "./server-build.mjs";

export const LOCAL_RUNTIME_IMAGE = "ghcr.io/zitadel/nextgen:local-dev";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));

export function linuxArchForNodeArch(arch = process.arch) {
  if (arch === "x64") {
    return "amd64";
  }
  if (arch === "arm64") {
    return "arm64";
  }
  throw new Error(`Unsupported local runtime image architecture: ${arch}`);
}

export async function buildLocalRuntimeImage(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const image = options.image ?? LOCAL_RUNTIME_IMAGE;
  const linuxArch = options.linuxArch ?? linuxArchForNodeArch(options.nodeArch ?? process.arch);
  const platform = { goos: "linux", goarch: linuxArch };
  const platformName = `linux/${linuxArch}`;
  const mkdtempFn = options.mkdtemp ?? mkdtemp;
  const rmFn = options.rm ?? rm;
  const runFn = options.run ?? run;
  const runCaptureFn = options.runCapture ?? runCapture;
  const prepareDockerContextFn = options.prepareDockerContext ?? prepareDockerContext;
  const baseEnv = {
    ...process.env,
    ...(options.env ?? {}),
  };
  const release = options.release ?? (await readServerRelease(repoRoot));
  const info = options.gitInfo ?? (await gitInfo({ repoRoot, runCapture: runCaptureFn }));
  const contextRoot = await mkdtempFn(
    join(options.tmpdir ?? systemTmpdir(), "zitadel-local-image-"),
  );

  try {
    await buildServerBinaries({
      repoRoot,
      outDir: contextRoot,
      // A local dev image is not a release. Stamping release.version here would
      // make `zitadel start --runtime docker` report the published version — in
      // logs and in OTel service.version — for a binary built off arbitrary
      // local HEAD. The image tag and Docker context still carry `release`.
      version: localServerVersion(info),
      gitInfo: info,
      platforms: [platform],
      run: runFn,
      runCapture: runCaptureFn,
      env: baseEnv,
    });
    const contextDir = await prepareDockerContextFn({
      repoRoot,
      outDir: contextRoot,
      version: release.version,
      platforms: [platform],
    });
    await buildContainerImage({
      repoRoot,
      contextDir,
      image,
      load: true,
      platforms: [platform],
      release,
      run: runFn,
      tags: [image],
    });
    return { image, platform: platformName };
  } finally {
    await rmFn(contextRoot, { recursive: true, force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const result = await buildLocalRuntimeImage();
    console.log(result.image);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(exitCodeForError(error));
  }
}

function exitCodeForError(error) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
    ? error.code
    : 1;
}
