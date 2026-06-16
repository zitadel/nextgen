import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const packageDirs = [
  "apps/cli",
  "packages/api",
  "packages/components",
  "packages/sdk-core",
  "packages/sdk-next",
  "packages/sdk-nuxt",
  "packages/sdk-react",
  "packages/sdk-vue",
  "packages/sdk-angular",
];

export function localRegistryPaths(workDir) {
  return {
    composeEnvPath: join(workDir, "compose.env"),
    npmrcPath: join(workDir, "verdaccio.npmrc"),
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
  await writeVerdaccioConfig(paths.verdaccioConfigPath, input);
  await writeVerdaccioNpmrc(paths.npmrcPath, input.registryUrl, input);
  await writeComposeEnv(paths.composeEnvPath, input.registryPort, paths, input);

  await buildPackages(input.repoRoot, input.run, env, log);
  await packPackages(input.repoRoot, paths.tarballsDir, input.run, env, log);
  await verifyTarballs(input.repoRoot, paths.tarballsDir, input.run, env);
  await restartLocalRegistry(input.compose, input.run, env, log);
  await input.onStarted?.();
  await waitForHttpFn(input)(`${input.registryUrl}/-/ping`, "Verdaccio", undefined, log);
  await publishTarballs(
    input.repoRoot,
    paths.tarballsDir,
    input.registryUrl,
    paths.npmrcPath,
    input.run,
    env,
  );

  return { paths, env: npmEnvironment(env, input.registryUrl, paths.npmrcPath) };
}

export async function buildPackages(repoRoot, run, env, log = () => undefined) {
  const projectNames = await Promise.all(packageDirs.map((dir) => packageName(repoRoot, dir)));
  log(`building ${projectNames.join(", ")}`);
  for (const projectName of projectNames) {
    await run("moon", ["run", `${moonProjectId(projectName)}:build`], { cwd: repoRoot, env });
  }
}

function moonProjectId(packageName) {
  return packageName.replace(/^@zitadel\//, "");
}

export async function packPackages(repoRoot, tarballsDir, run, env, log = () => undefined) {
  log(`packing npm tarballs into ${tarballsDir}`);
  for (const dir of packageDirs) {
    await run("corepack", [
      "pnpm",
      "--dir",
      dir,
      "pack",
      "--pack-destination",
      tarballsDir,
    ], { cwd: repoRoot, env });
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

export async function restartLocalRegistry(compose, run, env, log = () => undefined) {
  log("starting Verdaccio");
  await run("docker", composeArgs(compose, ["down", "-v", "--remove-orphans"]), {
    cwd: compose.repoRoot,
    env,
  }).catch(() => undefined);
  await run("docker", composeArgs(compose, ["up", "-d", "verdaccio"]), {
    cwd: compose.repoRoot,
    env,
  });
}

export async function stopLocalRegistry(compose, run, env) {
  await run("docker", composeArgs(compose, ["down", "-v", "--remove-orphans"]), {
    cwd: compose.repoRoot,
    env,
  });
}

export function composeArgs(compose, args) {
  return [
    "compose",
    "--project-name",
    compose.projectName,
    "--env-file",
    compose.envPath,
    "-f",
    compose.file,
    ...args,
  ];
}

export async function waitForHttp(url, label, child, log = () => undefined) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
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

export function localRegistryProjectName(repoRoot) {
  const hash = createHash("sha256").update(repoRoot).digest("hex").slice(0, 12);
  return `zitadel-local-packages-${hash}`;
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

async function writeVerdaccioConfig(path, input) {
  await writeFileFn(input)(
    path,
    `storage: /verdaccio/storage
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

async function writeVerdaccioNpmrc(path, registryUrl, input) {
  const url = new URL(registryUrl);
  await writeFileFn(input)(
    path,
    `registry=${registryUrl}/
//${url.host}/:_authToken=journey-token
`,
  );
}

async function writeComposeEnv(path, registryPort, paths, input) {
  await writeFileFn(input)(
    path,
    [
      `JOURNEY_REGISTRY_PORT=${registryPort}`,
      `JOURNEY_VERDACCIO_CONFIG=${paths.verdaccioConfigPath}`,
      `JOURNEY_VERDACCIO_STORAGE=${paths.storagePath}`,
      "",
    ].join("\n"),
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
