import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { PUBLIC_PACKAGE_DIRS } from "../../../scripts/release-manifest.mjs";

export const packageDirs = [...PUBLIC_PACKAGE_DIRS];

export function localRegistryPaths(workDir) {
  return {
    npmrcPath: join(workDir, "verdaccio.npmrc"),
    registryLogPath: join(workDir, "verdaccio", "verdaccio.log"),
    storagePath: join(workDir, "verdaccio", "storage"),
    tarballsDir: join(workDir, "npm-packages"),
    verdaccioConfigPath: join(workDir, "verdaccio", "config.yaml"),
  };
}

export async function prepareLocalRegistry(input) {
  const paths = input.paths ?? localRegistryPaths(input.workDir);
  const log = input.log ?? (() => undefined);
  const resetStorage = input.resetStorage ?? true;
  const env = input.env ?? process.env;

  if (resetStorage) {
    await resetDirectory(paths.tarballsDir, input);
    await resetDirectory(paths.storagePath, input);
  } else {
    await mkdirFn(input)(paths.tarballsDir, { recursive: true });
    await mkdirFn(input)(paths.storagePath, { recursive: true });
  }
  await mkdirFn(input)(dirname(paths.verdaccioConfigPath), { recursive: true });
  await writeVerdaccioConfig(paths.verdaccioConfigPath, paths.storagePath, input);
  await writeVerdaccioNpmrc(paths.npmrcPath, input.registryUrl, input);

  await buildPackages(input.repoRoot, input.run, env, log, input.prebuiltTarballsDir);
  await packPackages(input.repoRoot, paths.tarballsDir, input.run, env, log, input.prebuiltTarballsDir);
  await verifyTarballs(input.repoRoot, paths.tarballsDir, input.run, env);
  const startRegistry = input.startLocalRegistry ?? startLocalRegistry;
  const registry = await startRegistry({
    env,
    log,
    paths,
    registryPort: input.registryPort,
    repoRoot: input.repoRoot,
  });
  await input.onStarted?.(registry);
  await waitForHttpFn(input)(`${input.registryUrl}/-/ping`, "Verdaccio", registry, log);
  await publishTarballs(
    input.repoRoot,
    paths.tarballsDir,
    input.registryUrl,
    paths.npmrcPath,
    input.run,
    env,
  );

  return { paths, registry, env: npmEnvironment(env, input.registryUrl, paths.npmrcPath) };
}

export async function buildPackages(repoRoot, run, env, log = () => undefined, prebuiltTarballsDir = "") {
  if (prebuiltTarballsDir) {
    log(`using prebuilt release npm tarballs from ${prebuiltTarballsDir}`);
    return;
  }
  const projectNames = await Promise.all(packageDirs.map((dir) => packageName(repoRoot, dir)));
  log(`building release npm tarballs for ${projectNames.join(", ")}`);
  await run("moon", ["run", "release:pack"], { cwd: repoRoot, env });
}

export async function packPackages(repoRoot, tarballsDir, _run, _env, log = () => undefined, prebuiltTarballsDir = "") {
  log(`copying npm tarballs into ${tarballsDir}`);
  const version = prebuiltTarballsDir ? "" : await packageVersion(repoRoot, "apps/server");
  const sourceDir = prebuiltTarballsDir || join(repoRoot, "dist", "release", version, "npm");
  const tarballs = (await readdir(sourceDir)).filter((file) => file.endsWith(".tgz")).sort();
  if (tarballs.length === 0) {
    throw new Error(`no release npm tarballs found in ${sourceDir}`);
  }
  for (const tarball of tarballs) {
    await cp(join(sourceDir, tarball), join(tarballsDir, tarball));
  }
}

export async function verifyTarballs(repoRoot, tarballsDir, run, env) {
  await run("node", [
    "apps/cli-journey-e2e/scripts/verify-tarballs.mjs",
    tarballsDir,
  ], { cwd: repoRoot, env });
}

export async function publishTarballs(repoRoot, tarballsDir, registryUrl, npmrcPath, run, env) {
  await run("node", [
    "apps/cli-journey-e2e/scripts/publish-tarballs.mjs",
    tarballsDir,
  ], {
    cwd: repoRoot,
    env: {
      ...env,
      JOURNEY_REGISTRY_URL: registryUrl,
      NPM_CONFIG_USERCONFIG: npmrcPath,
    },
  });
}

export async function startLocalRegistry(input) {
  const log = input.log ?? (() => undefined);
  log("starting Verdaccio");
  await mkdir(dirname(input.paths.registryLogPath), { recursive: true });
  const logFile = await open(input.paths.registryLogPath, "a", 0o600);
  try {
    const child = spawn(
      "corepack",
      [
        "pnpm",
        "exec",
        "verdaccio",
        "--config",
        input.paths.verdaccioConfigPath,
        "--listen",
        `127.0.0.1:${String(input.registryPort)}`,
      ],
      {
        cwd: input.repoRoot,
        env: input.env,
        stdio: ["ignore", logFile.fd, logFile.fd],
      },
    );
    child.logFile = input.paths.registryLogPath;
    child.on("error", (error) => {
      child.spawnError = error;
    });
    return child;
  } finally {
    await logFile.close();
  }
}

export async function stopLocalRegistry(registry) {
  if (!registry || registry.exitCode !== null) {
    return;
  }
  registry.kill("SIGTERM");
  await new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      if (registry.exitCode === null) {
        registry.kill("SIGKILL");
      }
      resolveStop();
    }, 5000);
    registry.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
  });
}

export async function waitForHttp(url, label, child, log = () => undefined) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.spawnError) {
      throw new Error(`${label} failed to start; see ${child.logFile}: ${child.spawnError.message}`);
    }
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready; see ${child.logFile}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        log(`${label} is ready at ${url}`);
        return;
      }
      const body = await response.text().catch(() => "");
      const detail = body ? `: ${body.slice(0, 1000)}` : "";
      lastError = new Error(`${url} returned ${response.status}${detail}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw new Error(`timed out waiting for ${label} at ${url}: ${lastError?.message}`);
}

export function npmEnvironment(env, registryUrl, npmrcPath) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toLowerCase().startsWith("npm_config_")) {
      delete next[key];
    }
  }
  return {
    ...next,
    NPM_CONFIG_USERCONFIG: npmrcPath,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_registry: registryUrl,
    npm_config_yes: "true",
  };
}

export async function packageName(repoRoot, relativePath) {
  const manifest = JSON.parse(
    await readFile(join(repoRoot, relativePath, "package.json"), "utf8"),
  );
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${relativePath}/package.json has no name`);
  }
  return manifest.name;
}

export async function packageVersion(repoRoot, relativePath) {
  const manifest = JSON.parse(
    await readFile(join(repoRoot, relativePath, "package.json"), "utf8"),
  );
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${relativePath}/package.json has no version`);
  }
  return manifest.version;
}

export function localRegistryPort(repoRoot, env = process.env) {
  const explicit = env.ZITADEL_CLI_LOCAL_REGISTRY_PORT;
  if (explicit) {
    const port = Number(explicit);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error(`ZITADEL_CLI_LOCAL_REGISTRY_PORT must be a TCP port, got ${explicit}`);
    }
    return port;
  }
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 8);
  return 54_873 + (Number.parseInt(hash, 16) % 10_000);
}

async function resetDirectory(path, input) {
  await rmFn(input)(path, { recursive: true, force: true });
  await mkdirFn(input)(path, { recursive: true });
}

export async function writeVerdaccioConfig(path, storagePath, input = {}) {
  await writeFileFn(input)(
    path,
    `storage: ${storagePath}
max_body_size: 200mb
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '@zitadel/*':
    access: $all
    publish: $all
    unpublish: $all
  '@*/*':
    access: $all
    publish: $all
    unpublish: $all
    proxy: npmjs
  '**':
    access: $all
    publish: $all
    unpublish: $all
    proxy: npmjs
logs:
  - { type: stdout, format: pretty, level: http }
`,
  );
}

export async function writeVerdaccioNpmrc(path, registryUrl, input = {}) {
  const url = new URL(registryUrl);
  await writeFileFn(input)(
    path,
    `registry=${registryUrl}/
//${url.host}/:_authToken=journey-token
`,
  );
}

function rmFn(input) {
  return input.rm ?? rm;
}

function mkdirFn(input) {
  return input.mkdir ?? mkdir;
}

function writeFileFn(input) {
  return input.writeFile ?? writeFile;
}

function waitForHttpFn(input) {
  return input.waitForHttp ?? waitForHttp;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
