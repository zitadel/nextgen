import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const repoRoot = resolve(projectRoot, "../..");
const composeFile = join(projectRoot, "docker-compose.local.yaml");
const devEncryptionKey =
  "4d61737465726b65794e65656473546f48617665333243686172616374657273";
const packageDirs = [
  "apps/cli",
  "packages/api",
  "packages/components",
  "packages/sdk-core",
  "packages/sdk-next",
  "packages/sdk-nuxt",
];

const options = parseArgs(process.argv.slice(2));
const workDir = resolve(
  options.workDir || (await mkdtemp(join(tmpdir(), "zitadel-cli-journey-local-"))),
);
const tarballsDir = join(workDir, "npm-packages");
const diagnosticsDir = join(workDir, "diagnostics");
const composeEnvPath = join(workDir, "compose.env");
const verdaccioConfigPath = join(workDir, "verdaccio", "config.yaml");
const verdaccioStoragePath = join(workDir, "verdaccio", "storage");
const verdaccioNpmrcPath = join(workDir, "verdaccio.npmrc");
const backendLogPath = join(diagnosticsDir, "backend.log");
const nextLogPath = join(diagnosticsDir, "next-app.log");
const composeLogPath = join(diagnosticsDir, "compose.log");
const composeProjectName = `zitadel-journey-${process.pid}-${Date.now()}`;
const registryPort = await resolvePort("JOURNEY_REGISTRY_PORT");
const backendPort = await resolvePort("JOURNEY_BACKEND_PORT");
const appPort = await resolvePort("JOURNEY_APP_PORT");
const registryUrl = `http://127.0.0.1:${registryPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const appUrl = `http://localhost:${appPort}`;
const childProcesses = new Set();
let composeStarted = false;
let cleanupStarted = false;
let success = false;

process.on("SIGINT", () => void handleSignal("SIGINT"));
process.on("SIGTERM", () => void handleSignal("SIGTERM"));

try {
  await mkdir(tarballsDir, { recursive: true });
  await mkdir(diagnosticsDir, { recursive: true });
  await mkdir(dirname(verdaccioConfigPath), { recursive: true });
  await mkdir(verdaccioStoragePath, { recursive: true });

  await writeVerdaccioConfig();
  await writeVerdaccioNpmrc();
  await writeComposeEnv();

  log(`work dir: ${workDir}`);
  await buildPackages();
  await packPackages();
  await run("node", [
    "apps/cli-journey-e2e/scripts/verify-tarballs.mjs",
    tarballsDir,
  ]);

  await startCompose();
  await waitForHttp(`${registryUrl}/-/ping`, "Verdaccio");

  await run(
    "node",
    ["apps/cli-journey-e2e/scripts/publish-tarballs.mjs", tarballsDir],
    {
      env: {
        ...process.env,
        JOURNEY_REGISTRY_URL: registryUrl,
        NPM_CONFIG_USERCONFIG: verdaccioNpmrcPath,
      },
    },
  );

  let backendProcess;
  if (options.backend === "image") {
    await waitForHttp(`${backendUrl}/healthz`, "backend image");
  } else {
    backendProcess = await startSourceBackend();
    await waitForHttp(`${backendUrl}/healthz`, "source backend", backendProcess);
  }

  await run("node", ["apps/cli-journey-e2e/scripts/prepare-next-app.mjs"], {
    env: {
      ...process.env,
      JOURNEY_APP_URL: appUrl,
      JOURNEY_BACKEND_URL: backendUrl,
      JOURNEY_REGISTRY_URL: registryUrl,
      JOURNEY_WORK_DIR: workDir,
      NPM_CONFIG_USERCONFIG: verdaccioNpmrcPath,
    },
  });

  const appDir = join(workDir, "myapp");
  const nextProcess = startChild("npm", [
    "run",
    "dev",
    "--",
    "--hostname",
    "localhost",
    "--port",
    String(appPort),
  ], {
    cwd: appDir,
    env: process.env,
    logFile: nextLogPath,
  });
  await waitForHttp(`${appUrl}/login`, "generated Next.js app", nextProcess);

  await run(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@zitadel/cli-journey-e2e",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.config.mts",
    ],
    {
      env: {
        ...process.env,
        JOURNEY_APP_DIR: appDir,
        JOURNEY_APP_URL: appUrl,
        JOURNEY_OUTPUT_DIR: workDir,
      },
    },
  );

  success = true;
  log("local consumer journey passed");
} catch (error) {
  await collectDiagnostics();
  console.error("");
  console.error(`[journey-local] failed: ${error.message}`);
  console.error(`[journey-local] diagnostics preserved in ${workDir}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  if (success && !options.keep) {
    await rm(workDir, { recursive: true, force: true });
  } else if (success) {
    log(`kept work dir: ${workDir}`);
  }
}

process.exit(process.exitCode ?? 0);

function parseArgs(args) {
  const parsed = {
    backend: "source",
    image: "",
    keep: false,
    workDir: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--backend": {
        parsed.backend = readValue(args, ++index, arg);
        break;
      }
      case "--image": {
        parsed.image = readValue(args, ++index, arg);
        break;
      }
      case "--keep": {
        parsed.keep = true;
        break;
      }
      case "--work-dir": {
        parsed.workDir = readValue(args, ++index, arg);
        break;
      }
      case "--help": {
        printUsage();
        process.exit(0);
        break;
      }
      default: {
        throw new Error(`unknown argument: ${arg}`);
      }
    }
  }

  if (!["source", "image"].includes(parsed.backend)) {
    throw new Error(`--backend must be "source" or "image", got ${parsed.backend}`);
  }
  if (parsed.backend === "image" && !parsed.image) {
    throw new Error("--backend image requires --image <docker-tag>");
  }
  return parsed;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printUsage() {
  console.log(`usage: node scripts/run-local.mjs [options]

Options:
  --backend source          Run go run . server with embedded Postgres (default)
  --backend image           Run the backend through docker compose
  --image <docker-tag>      Required with --backend image
  --keep                    Keep the temp work directory after success
  --work-dir <path>         Use an explicit work directory
`);
}

async function resolvePort(envName) {
  const value = process.env[envName];
  if (value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`${envName} must be a TCP port, got ${value}`);
    }
    return port;
  }
  return freePort();
}

function freePort() {
  return new Promise((resolvePortPromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("unable to allocate TCP port"));
        return;
      }
      server.close(() => resolvePortPromise(address.port));
    });
  });
}

async function writeVerdaccioConfig() {
  await writeFile(
    verdaccioConfigPath,
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

async function writeVerdaccioNpmrc() {
  await writeFile(
    verdaccioNpmrcPath,
    `registry=${registryUrl}/
//127.0.0.1:${registryPort}/:_authToken=journey-token
`,
  );
}

async function writeComposeEnv() {
  await writeFile(
    composeEnvPath,
    [
      `JOURNEY_REGISTRY_PORT=${registryPort}`,
      `JOURNEY_BACKEND_PORT=${backendPort}`,
      `JOURNEY_BACKEND_IMAGE=${options.image || "unused"}`,
      `JOURNEY_VERDACCIO_CONFIG=${verdaccioConfigPath}`,
      `JOURNEY_VERDACCIO_STORAGE=${verdaccioStoragePath}`,
      `NEXTGEN_SERVER_ENCRYPTION_KEY=${devEncryptionKey}`,
      "",
    ].join("\n"),
  );
}

async function buildPackages() {
  const projectNames = await Promise.all(packageDirs.map(packageName));
  log(`building ${projectNames.join(", ")}`);
  await run("corepack", [
    "pnpm",
    "nx",
    "run-many",
    "-t",
    "build",
    "-p",
    projectNames.join(","),
  ]);
}

async function packPackages() {
  log(`packing npm tarballs into ${tarballsDir}`);
  for (const dir of packageDirs) {
    await run("corepack", [
      "pnpm",
      "--dir",
      dir,
      "pack",
      "--pack-destination",
      tarballsDir,
    ]);
  }
}

async function packageName(relativePath) {
  const manifest = JSON.parse(
    await readFile(join(repoRoot, relativePath, "package.json"), "utf8"),
  );
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${relativePath}/package.json has no name`);
  }
  return manifest.name;
}

async function startCompose() {
  if (options.backend === "image") {
    log(`starting Verdaccio and backend image ${options.image}`);
    await run("docker", composeArgs(["up", "-d", "verdaccio", "nextgen"], true));
  } else {
    log("starting Verdaccio");
    await run("docker", composeArgs(["up", "-d", "verdaccio"]));
  }
  composeStarted = true;
}

async function startSourceBackend() {
  log(`starting source backend on ${backendUrl}`);
  const env = {
    ...process.env,
    NEXTGEN_SERVER_ADDRESS: `127.0.0.1:${backendPort}`,
    NEXTGEN_SERVER_CONSOLE_ENABLED: "false",
    NEXTGEN_SERVER_ENCRYPTION_KEY: devEncryptionKey,
    NEXTGEN_SERVER_LOGIN_ENABLED: "false",
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NEXTGEN_DATABASE_")) {
      delete env[key];
    }
  }
  return startChild("go", ["run", ".", "server"], {
    cwd: repoRoot,
    env,
    logFile: backendLogPath,
  });
}

async function waitForHttp(url, label, child) {
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
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw new Error(`timed out waiting for ${label} at ${url}: ${lastError?.message}`);
}

function startChild(command, args, optionsForChild) {
  const output = createWriteStream(optionsForChild.logFile, { flags: "a" });
  const child = spawn(command, args, {
    cwd: optionsForChild.cwd,
    env: optionsForChild.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.logFile = optionsForChild.logFile;
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.on("exit", () => {
    output.end();
    childProcesses.delete(child);
  });
  childProcesses.add(child);
  return child;
}

function run(command, args, optionsForRun = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: optionsForRun.cwd ?? repoRoot,
      env: optionsForRun.env ?? process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

function runCapture(command, args, optionsForRun = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: optionsForRun.cwd ?? repoRoot,
      env: optionsForRun.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
        ),
      );
    });
  });
}

function composeArgs(args, includeImageProfile = false) {
  const base = [
    "compose",
    "--project-name",
    composeProjectName,
    "--env-file",
    composeEnvPath,
    "-f",
    composeFile,
  ];
  if (includeImageProfile) {
    base.push("--profile", "backend-image");
  }
  return [...base, ...args];
}

async function collectDiagnostics() {
  await mkdir(diagnosticsDir, { recursive: true });
  if (composeStarted) {
    try {
      const result = await runCapture(
        "docker",
        composeArgs(["logs"], options.backend === "image"),
      );
      await writeFile(composeLogPath, `${result.stdout}${result.stderr}`);
    } catch (error) {
      await writeFile(composeLogPath, `failed to collect compose logs: ${error.message}\n`);
    }
  }

  const appDir = join(workDir, "myapp");
  await copyIfExists(join(workDir, "setup.json"), join(diagnosticsDir, "setup.json"));
  await copyIfExists(
    join(workDir, "setup.stderr.log"),
    join(diagnosticsDir, "setup.stderr.log"),
  );
  await copyIfExists(join(workDir, "metadata.json"), join(diagnosticsDir, "metadata.json"));
  await mkdir(join(diagnosticsDir, "generated-app"), { recursive: true });
  await copyIfExists(
    join(appDir, "package.json"),
    join(diagnosticsDir, "generated-app", "package.json"),
  );
  await copyIfExists(
    join(appDir, "package-lock.json"),
    join(diagnosticsDir, "generated-app", "package-lock.json"),
  );
  await copyIfExists(
    join(projectRoot, "test-output", "playwright"),
    join(diagnosticsDir, "playwright"),
  );
}

async function copyIfExists(source, destination) {
  try {
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;

  for (const child of [...childProcesses]) {
    await stopChild(child);
  }

  if (composeStarted) {
    try {
      await run("docker", composeArgs(["down", "-v", "--remove-orphans"], true));
    } catch (error) {
      console.error(`[journey-local] docker compose cleanup failed: ${error.message}`);
    }
  }
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await waitForExit(child, 5000);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child, 5000);
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveWait) => {
    if (child.exitCode !== null) {
      resolveWait(true);
      return;
    }
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolveWait(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveWait(true);
    };
    child.once("exit", onExit);
  });
}

async function handleSignal(signal) {
  console.error(`[journey-local] received ${signal}, cleaning up`);
  await collectDiagnostics();
  await cleanup();
  process.exit(130);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function log(message) {
  console.log(`[journey-local] ${message}`);
}
