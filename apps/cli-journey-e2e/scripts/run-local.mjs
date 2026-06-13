import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";

import {
  composeArgs,
  localRegistryPaths,
  npmEnvironment,
  packageName,
  prepareLocalRegistry,
  stopLocalRegistry,
  waitForHttp,
} from "./local-registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const repoRoot = resolve(projectRoot, "../..");
const composeFile = join(projectRoot, "docker-compose.local.yaml");

const options = parseArgsOrExit(process.argv.slice(2));
const workDir = resolve(
  options.workDir || (await mkdtemp(join(tmpdir(), "zitadel-cli-journey-local-"))),
);
const diagnosticsDir = join(workDir, "diagnostics");
const appDir = join(workDir, "myapp");
const registryPaths = localRegistryPaths(workDir);
const nextLogPath = join(diagnosticsDir, "next-app.log");
const composeLogPath = join(diagnosticsDir, "compose.log");
const composeProjectName = `zitadel-journey-${process.pid}-${Date.now()}`;
const registryPort = await resolvePort("JOURNEY_REGISTRY_PORT");
const appPort = await resolvePort("JOURNEY_APP_PORT", 3000);
const zitadelPort = await resolvePort("JOURNEY_ZITADEL_PORT");
const registryUrl = `http://127.0.0.1:${registryPort}`;
const appUrl = `http://localhost:${appPort}`;
const cliPackage = await packageName(repoRoot, "apps/cli");
const compose = {
  envPath: registryPaths.composeEnvPath,
  file: composeFile,
  projectName: composeProjectName,
  repoRoot,
};
const childProcesses = new Set();
let composeStarted = false;
let cleanupStarted = false;
let success = false;
let localRuntimeImage = process.env.ZITADEL_LOCAL_IMAGE || options.image;

process.on("SIGINT", () => void handleSignal("SIGINT"));
process.on("SIGTERM", () => void handleSignal("SIGTERM"));

try {
  await mkdir(diagnosticsDir, { recursive: true });

  log(`work dir: ${workDir}`);
  await assertDockerAvailable();
  await ensurePlaywrightBrowsers();
  await prepareLocalRegistry({
    compose,
    env: process.env,
    log,
    onStarted: () => {
      composeStarted = true;
    },
    paths: registryPaths,
    registryPort,
    registryUrl,
    repoRoot,
    run,
    workDir,
  });

  if (!localRuntimeImage) {
    log("building local runtime image for npx @zitadel/cli@alpha start");
    localRuntimeImage = await buildJourneyRuntimeImage();
  }

  await run("node", ["apps/cli-journey-e2e/scripts/prepare-next-app.mjs"], {
    env: {
      ...process.env,
      JOURNEY_APP_URL: appUrl,
      JOURNEY_ZITADEL_PORT: String(zitadelPort),
      JOURNEY_REGISTRY_URL: registryUrl,
      JOURNEY_WORK_DIR: workDir,
      NPM_CONFIG_USERCONFIG: registryPaths.npmrcPath,
      ZITADEL_LOCAL_IMAGE: localRuntimeImage,
    },
  });

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
  log("customer local setup journey passed");
} catch (error) {
  await collectDiagnostics();
  console.error("");
  console.error(`[journey-local] failed: ${errorMessage(error)}`);
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

function parseArgsOrExit(args) {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(`[journey-local] ${errorMessage(error)}`);
    process.exit(1);
  }
}

function parseArgs(args) {
  const parsed = {
    image: "",
    keep: false,
    workDir: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--backend": {
        readValue(args, ++index, arg);
        throw new Error(
          [
            "--backend was removed from the journey runner.",
            "The journey now always exercises `npx @zitadel/cli@alpha start`.",
            "Remove `--backend`, or pass `--image <docker-tag>` / set ZITADEL_LOCAL_IMAGE to choose the local runtime image.",
          ].join(" "),
        );
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
  --image <docker-tag>      Use an existing local runtime image instead of building one
  --keep                    Keep the temp work directory after success
  --work-dir <path>         Use an explicit work directory
`);
}

async function resolvePort(envName, fallback) {
  const value = process.env[envName];
  if (value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`${envName} must be a TCP port, got ${value}`);
    }
    return port;
  }
  if (fallback) {
    return fallback;
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

async function ensurePlaywrightBrowsers() {
  log("ensuring Playwright Chromium browsers are installed");
  await run("corepack", [
    "pnpm",
    "--filter",
    "@zitadel/cli-journey-e2e",
    "exec",
    "playwright",
    "install",
    "chromium",
  ]);
}

async function buildJourneyRuntimeImage() {
  const result = await runCapture("node", ["scripts/build-local-runtime-image.mjs"]);
  const image = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!image) {
    throw new Error("local runtime image build did not print an image tag");
  }
  return image;
}

async function assertDockerAvailable() {
  let engineVersion = "";
  let composeVersion = "";

  try {
    const result = await runCapture("docker", ["info", "--format", "{{.ServerVersion}}"]);
    engineVersion = result.stdout.trim();
  } catch (error) {
    throw new Error(
      [
        "Docker is required for the local journey runner because Verdaccio runs through Docker Compose.",
        "Start Docker Desktop or another Docker daemon, wait until `docker ps` works, then rerun this command.",
        `Docker daemon check failed: ${commandErrorDetail(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }

  try {
    const result = await runCapture("docker", ["compose", "version", "--short"]);
    composeVersion = result.stdout.trim();
  } catch (error) {
    throw new Error(
      [
        "Docker Compose is required for the local journey runner because Verdaccio runs through Docker Compose.",
        "Install or enable the Docker Compose plugin, then rerun this command.",
        `Docker Compose check failed: ${commandErrorDetail(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }

  const versionDetails = [
    engineVersion ? `engine ${engineVersion}` : "",
    composeVersion ? `compose ${composeVersion}` : "",
  ].filter(Boolean);
  log(`Docker is available${versionDetails.length > 0 ? ` (${versionDetails.join(", ")})` : ""}`);
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

function commandErrorDetail(error) {
  const message = errorMessage(error);
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const stderrIndex = lines.indexOf("STDERR:");
  const stdoutIndex = lines.indexOf("STDOUT:");
  const stderrLines = stderrIndex === -1 ? [] : lines.slice(stderrIndex + 1);
  const stdoutLines =
    stdoutIndex === -1
      ? []
      : lines.slice(stdoutIndex + 1, stderrIndex === -1 ? undefined : stderrIndex);
  const detailLines = [...stderrLines, ...stdoutLines].filter(Boolean);
  return (detailLines.length > 0 ? detailLines : lines).slice(-4).join("\n");
}

async function collectDiagnostics() {
  await mkdir(diagnosticsDir, { recursive: true });
  await collectLocalRuntimeLogs();
  if (composeStarted) {
    try {
      const result = await runCapture(
        "docker",
        composeArgs(compose, ["logs"]),
      );
      await writeFile(composeLogPath, `${result.stdout}${result.stderr}`);
    } catch (error) {
      await writeFile(composeLogPath, `failed to collect compose logs: ${errorMessage(error)}\n`);
    }
  }

  await copyIfExists(join(workDir, "doctor.json"), join(diagnosticsDir, "doctor.json"));
  await copyIfExists(
    join(workDir, "doctor.stderr.log"),
    join(diagnosticsDir, "doctor.stderr.log"),
  );
  await copyIfExists(join(workDir, "start.json"), join(diagnosticsDir, "start.json"));
  await copyIfExists(
    join(workDir, "start.stderr.log"),
    join(diagnosticsDir, "start.stderr.log"),
  );
  await copyIfExists(join(workDir, "setup.json"), join(diagnosticsDir, "setup.json"));
  await copyIfExists(
    join(workDir, "setup.stderr.log"),
    join(diagnosticsDir, "setup.stderr.log"),
  );
  await copyIfExists(join(workDir, "metadata.json"), join(diagnosticsDir, "metadata.json"));
  await copyIfExists(join(workDir, "logs.json"), join(diagnosticsDir, "logs.json"));
  await copyIfExists(join(workDir, "logs.stderr.log"), join(diagnosticsDir, "logs.stderr.log"));
  await copyIfExists(
    join(appDir, ".zitadel/local/runtime.json"),
    join(diagnosticsDir, "runtime.json"),
  );
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

async function collectLocalRuntimeLogs() {
  try {
    const result = await runCapture(
      "npx",
      cliArgs(["logs", "--tail", "400"]),
      { cwd: appDir, env: npxEnv() },
    );
    await writeFile(join(diagnosticsDir, "logs.json"), result.stdout);
    await writeFile(join(diagnosticsDir, "logs.stderr.log"), result.stderr);
  } catch (error) {
    await writeFile(
      join(diagnosticsDir, "logs.stderr.log"),
      `failed to collect local runtime logs: ${errorMessage(error)}\n`,
    );
  }
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

  await resetLocalRuntime();

  if (composeStarted) {
    try {
      await stopLocalRegistry(compose, run, process.env);
    } catch (error) {
      console.error(`[journey-local] docker compose cleanup failed: ${errorMessage(error)}`);
    }
  }
}

async function resetLocalRuntime() {
  try {
    await runCapture(
      "npx",
      cliArgs(["reset", "--force"]),
      { cwd: appDir, env: npxEnv() },
    );
  } catch (error) {
    console.error(`[journey-local] local runtime reset failed: ${errorMessage(error)}`);
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

function cliArgs(args) {
  return ["--yes", `${cliPackage}@alpha`, ...args, "--non-interactive", "--json"];
}

function npxEnv() {
  const env = npmEnvironment(process.env, registryUrl, registryPaths.npmrcPath);
  const image = localRuntimeImage || process.env.ZITADEL_LOCAL_IMAGE;
  if (image) {
    env.ZITADEL_LOCAL_IMAGE = image;
  }
  return env;
}

function log(message) {
  console.log(`[journey-local] ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
