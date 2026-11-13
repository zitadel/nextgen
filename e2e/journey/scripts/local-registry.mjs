import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, cp, mkdir, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { runCapture } from "../../../scripts/dev-process.mjs";
// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { packPublicPackages } from "../../../scripts/release-artifacts.mjs";
// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { APP_RELEASE_PACKAGES, PUBLIC_PACKAGE_DIRS } from "../../../scripts/release-manifest.mjs";
import { packageName, parsePort } from "./lib.mjs";

export const packageDirs = [...PUBLIC_PACKAGE_DIRS];

// Verdaccio serves a proxied packument from its storage until it is `maxage`
// old, then asks npmjs again; the default is 2m, which makes a long journey
// run ask npmjs again for packuments it fetched minutes earlier. An hour skips
// those repeat checks within a run, and a store that a later run reuses
// (`resetStorage: false`) still sees an npmjs release within the hour.
export const UPLINK_MAXAGE = "1h";

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

  // The tarballs staged for this run are always rebuilt from the current
  // snapshot, so start from an empty staging dir either way.
  await resetDirectory(paths.tarballsDir, input);
  if (resetStorage) {
    await resetDirectory(paths.storagePath, input);
  } else {
    // Keep Verdaccio's uplink proxy cache — the public framework packages every
    // scaffold re-downloads from npmjs — but drop the locally published
    // @zitadel packages so this run's fresh snapshot republishes without a
    // version conflict.
    await mkdirFn(input)(paths.storagePath, { recursive: true });
    await rmFn(input)(join(paths.storagePath, "@zitadel"), { recursive: true, force: true });
  }
  await mkdirFn(input)(dirname(paths.verdaccioConfigPath), { recursive: true });
  await writeVerdaccioConfig(paths.verdaccioConfigPath, paths.storagePath, input);
  await writeVerdaccioNpmrc(paths.npmrcPath, input.registryUrl, input);

  if (input.packageSet === "app") {
    await buildAppPackages(input.repoRoot, input.run, env, log);
    await packAppPackages(input.repoRoot, paths.tarballsDir, env, log, input.runCapture);
    await verifyTarballs(input.repoRoot, paths.tarballsDir, input.run, env, ["--app-packages"]);
  } else if (input.packageDirs) {
    // A CI journey's own set (journey-packages.mjs), packed from the builds
    // its turbo task depends on. The ones every journey installs come packed
    // once from the `journey-packages` task (`shared`), the rest are packed
    // here.
    const shared = input.shared ?? { dirs: [], tarballsDir: "" };
    await packPackageDirs(
      input.repoRoot,
      paths.tarballsDir,
      input.packageDirs.filter((dir) => !shared.dirs.includes(dir)),
      env,
      log,
      input.runCapture,
    );
    if (shared.dirs.length > 0) {
      await copySharedTarballs(input.repoRoot, shared, paths.tarballsDir, log);
    }
    await verifyTarballs(input.repoRoot, paths.tarballsDir, input.run, env, [
      `--packages=${input.packageDirs.join(",")}`,
    ]);
  } else {
    await buildPackages(input.repoRoot, input.run, env, log, input.prebuiltTarballsDir);
    await packPackages(
      input.repoRoot,
      paths.tarballsDir,
      input.run,
      env,
      log,
      input.prebuiltTarballsDir,
    );
    await verifyTarballs(input.repoRoot, paths.tarballsDir, input.run, env);
  }
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

export async function buildPackages(
  repoRoot,
  run,
  env,
  log = () => undefined,
  prebuiltTarballsDir = "",
) {
  if (prebuiltTarballsDir) {
    log(`using prebuilt release npm tarballs from ${prebuiltTarballsDir}`);
    return;
  }
  const projectNames = await Promise.all(packageDirs.map((dir) => packageName(repoRoot, dir)));
  log(`building release npm tarballs for ${projectNames.join(", ")}`);
  await run("turbo", ["run", "@zitadel/release#pack"], { cwd: repoRoot, env });
}

export async function packPackages(
  repoRoot,
  tarballsDir,
  _run,
  _env,
  log = () => undefined,
  prebuiltTarballsDir = "",
) {
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

// The `app` package set: what a generated app installs, packed from the
// packages' cached dev builds. `@zitadel/release#pack` builds every public
// package and cross-compiles the server for every platform, none of which a
// generated app installs.
export async function buildAppPackages(repoRoot, run, env, log = () => undefined) {
  log(`building ${APP_RELEASE_PACKAGES.map((pkg) => pkg.name).join(", ")}`);
  await run("turbo", ["run", ...APP_RELEASE_PACKAGES.map((pkg) => `${pkg.name}#build`)], {
    cwd: repoRoot,
    env,
  });
}

// Each pack runs on pipes of its own (runReplayed in scripts/dev-process.mjs
// says why); a failed pack's error carries its output.
export async function packAppPackages(
  repoRoot,
  tarballsDir,
  env,
  log = () => undefined,
  runCaptureFn = runCapture,
) {
  const dirs = APP_RELEASE_PACKAGES.map((pkg) => pkg.dir);
  await packPackageDirs(repoRoot, tarballsDir, dirs, env, log, runCaptureFn);
}

export async function packPackageDirs(
  repoRoot,
  tarballsDir,
  dirs,
  env,
  log = () => undefined,
  runCaptureFn = runCapture,
) {
  log(`packing npm tarballs into ${tarballsDir}`);
  await packPublicPackages({
    repoRoot,
    dirs,
    tarballsDir,
    run: (command, args, options) => runCaptureFn(command, args, { ...options, env }),
  });
}

// The tarballs of `shared.dirs`, named as `pnpm pack` names them; the
// verification that follows checks that with the journey's own packs they make
// up exactly its set.
async function copySharedTarballs(repoRoot, shared, tarballsDir, log) {
  log(`copying the shared npm tarballs from ${shared.tarballsDir}`);
  for (const dir of shared.dirs) {
    const name = await packageName(repoRoot, dir);
    const file = `${name.replace(/^@/, "").replace("/", "-")}-${await packageVersion(repoRoot, dir)}.tgz`;
    await copyFile(
      join(shared.tarballsDir, file),
      join(tarballsDir, file),
      constants.COPYFILE_FICLONE,
    ).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
      throw new Error(
        `no ${file} in ${shared.tarballsDir}; run turbo run journey-packages --filter=@zitadel/e2e`,
      );
    });
  }
}

export async function verifyTarballs(repoRoot, tarballsDir, run, env, flags = []) {
  await run("node", ["e2e/journey/scripts/verify-tarballs.mjs", tarballsDir, ...flags], {
    cwd: repoRoot,
    env,
  });
}

export async function publishTarballs(repoRoot, tarballsDir, registryUrl, npmrcPath, run, env) {
  await run("node", ["e2e/journey/scripts/publish-tarballs.mjs", tarballsDir], {
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
  // Otherwise the readiness check passes against whatever holds the port,
  // the packages go there, and the Verdaccio started here exits unseen.
  const port = String(input.registryPort);
  if (await isServing(`http://127.0.0.1:${port}/-/ping`)) {
    throw new Error(
      `127.0.0.1:${port} is already in use, likely by a Verdaccio an earlier run left ` +
        `behind. Stop that process (lsof -i :${port}), or pick another port ` +
        "(ZITADEL_CLI_LOCAL_REGISTRY_PORT for the CLI wrapper).",
    );
  }
  log("starting Verdaccio");
  await mkdir(dirname(input.paths.registryLogPath), { recursive: true });
  const logFile = await open(input.paths.registryLogPath, "a", 0o600);
  try {
    // Verdaccio's own bin under this Node, one process: through `corepack
    // pnpm exec`, stopLocalRegistry's signal reached only corepack, and pnpm
    // and Verdaccio kept serving the port.
    const child = spawn(
      process.execPath,
      [
        join(input.repoRoot, "node_modules", "verdaccio", "bin", "verdaccio"),
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
      throw new Error(
        `${label} failed to start; see ${child.logFile}: ${child.spawnError.message}`,
      );
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

// Anything but a refused connection means something holds the port.
async function isServing(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch (error) {
    return error?.cause?.code !== "ECONNREFUSED";
  }
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

export async function packageVersion(repoRoot, relativePath) {
  const manifest = JSON.parse(await readFile(join(repoRoot, relativePath, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${relativePath}/package.json has no version`);
  }
  return manifest.version;
}

export function localRegistryPort(repoRoot, env = process.env) {
  const explicit = env.ZITADEL_CLI_LOCAL_REGISTRY_PORT;
  if (explicit) {
    return parsePort(explicit, "ZITADEL_CLI_LOCAL_REGISTRY_PORT");
  }
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 8);
  return 54_873 + (Number.parseInt(hash, 16) % 10_000);
}

async function resetDirectory(path, input) {
  await rmFn(input)(path, { recursive: true, force: true });
  await mkdirFn(input)(path, { recursive: true });
}

async function writeVerdaccioConfig(path, storagePath, input) {
  await writeFileFn(input)(
    path,
    `storage: ${storagePath}
max_body_size: 200mb
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    maxage: ${UPLINK_MAXAGE}
    timeout: 60s
    max_fails: 10
    fail_timeout: 10s
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

async function writeVerdaccioNpmrc(path, registryUrl, input) {
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
