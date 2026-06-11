#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir as systemTmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectRun, run, runCapture } from "./dev-process.mjs";

export const LOCAL_RUNTIME_IMAGE = "ghcr.io/zitadel/nextgen:local-dev";

const defaultRepoRoot = fileURLToPath(new URL("..", import.meta.url));
const fallbackServerTag = "v0.0.0";

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
  const platform = `linux/${linuxArch}`;
  const mkdtempFn = options.mkdtemp ?? mkdtemp;
  const mkdirFn = options.mkdir ?? mkdir;
  const copyFileFn = options.copyFile ?? copyFile;
  const readFileFn = options.readFile ?? readFile;
  const writeFileFn = options.writeFile ?? writeFile;
  const rmFn = options.rm ?? rm;
  const runFn = options.run ?? run;
  const runCaptureFn = options.runCapture ?? runCapture;
  const baseEnv = {
    ...process.env,
    ...(options.env ?? {}),
  };
  const goreleaserTagEnv = await resolveGoreleaserTagEnv({
    env: baseEnv,
    repoRoot,
    runCapture: runCaptureFn,
  });
  const env = {
    ...baseEnv,
    ...goreleaserTagEnv,
    CGO_ENABLED: "0",
    GOOS: "linux",
    GOARCH: linuxArch,
  };
  const contextDir = await mkdtempFn(
    join(options.tmpdir ?? systemTmpdir(), "zitadel-local-image-"),
  );
  const goreleaserConfigPath = join(contextDir, ".goreleaser.local.yaml");
  const goreleaserDistDir = join(contextDir, "goreleaser-dist");
  const binaryDir = join(contextDir, "linux", linuxArch);
  const binaryPath = join(binaryDir, "nextgen");

  try {
    await mkdirFn(binaryDir, { recursive: true });
    const goreleaserConfig = await readFileFn(join(repoRoot, ".goreleaser.yaml"), "utf8");
    await writeFileFn(
      goreleaserConfigPath,
      localGoreleaserConfig(goreleaserConfig, goreleaserDistDir),
    );
    await runFn(
      "goreleaser",
      [
        "build",
        "--config",
        goreleaserConfigPath,
        "--snapshot",
        "--clean",
        "--single-target",
        "--id",
        "nextgen",
        "--output",
        binaryPath,
      ],
      { cwd: repoRoot, env },
    );
    await copyFileFn(join(repoRoot, "Dockerfile"), join(contextDir, "Dockerfile"));
    await runFn("docker", ["build", "--platform", platform, "-t", image, contextDir], {
      cwd: repoRoot,
      env: baseEnv,
    });
    return { image, platform };
  } finally {
    await rmFn(contextDir, { recursive: true, force: true });
  }
}

export function localGoreleaserConfig(config, distDir) {
  const distLine = `dist: ${JSON.stringify(distDir)}`;
  if (/^dist\s*:/m.test(config)) {
    return config.replace(/^dist\s*:.*$/m, distLine);
  }
  return `${distLine}\n${config}`;
}

export async function resolveGoreleaserTagEnv(options = {}) {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const runCaptureFn = options.runCapture ?? runCapture;
  const currentTag =
    env.GORELEASER_CURRENT_TAG ??
    (await serverReleaseTag({ repoRoot, runCapture: runCaptureFn, env })) ??
    fallbackServerTag;

  return {
    ...(env.GORELEASER_CURRENT_TAG ? {} : { GORELEASER_CURRENT_TAG: currentTag }),
    ...(env.GORELEASER_PREVIOUS_TAG ? {} : { GORELEASER_PREVIOUS_TAG: currentTag }),
  };
}

async function serverReleaseTag({ repoRoot, runCapture: runCaptureFn, env }) {
  try {
    const { stdout } = await runCaptureFn(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--match", "[0-9]*"],
      { cwd: repoRoot, env },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
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
