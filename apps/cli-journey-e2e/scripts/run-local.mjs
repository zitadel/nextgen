import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { frameworkForId } from "./frameworks.mjs";
import { canListen, createJourneyPortAllocator } from "./ports.mjs";
import {
  localRegistryPaths,
  npmEnvironment,
  packageName,
  prepareLocalRegistry,
  stopLocalRegistry,
  waitForHttp,
} from "./local-registry.mjs";
import { parseLocalJourneyArgs } from "./run-options.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const repoRoot = resolve(projectRoot, "../..");

const options = parseArgsOrExit(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

const selectedFrameworks = options.frameworkIds.map(frameworkForId);
const workDir = resolve(
  options.workDir || (await mkdtemp(join(tmpdir(), "zitadel-cli-journey-local-"))),
);
const diagnosticsDir = join(workDir, "diagnostics");
const registryPaths = localRegistryPaths(workDir);
// Reserved ports are bound long after reservation (Verdaccio within seconds,
// the app and Zitadel ports only minutes later), so they come from the fixed
// non-ephemeral journey block — see ports.mjs for why listen(:0) flaked.
const usedPorts = new Set();
const reserveJourneyPort = createJourneyPortAllocator();
const registryPort = await resolvePort("JOURNEY_REGISTRY_PORT");
usedPorts.add(registryPort);
const registryUrl = `http://127.0.0.1:${registryPort}`;
const cliPackage = await packageName(repoRoot, "apps/cli");
const childProcesses = new Set();
const frameworkContexts = [];
const prebuiltTarballsDir = options.tarballsDir || process.env.JOURNEY_TARBALLS_DIR || "";
let registryProcess;
let registryLogsCollected = false;
let cleanupStarted = false;
let success = false;
let localRuntimeImage = options.runtime === "docker" ? process.env.ZITADEL_LOCAL_IMAGE || options.image : "";

process.on("SIGINT", () => void handleSignal("SIGINT"));
process.on("SIGTERM", () => void handleSignal("SIGTERM"));

try {
  assertMatrixPortsAreDynamic(selectedFrameworks);
  await mkdir(diagnosticsDir, { recursive: true });

  log(`work dir: ${workDir}`);
  log(`frameworks: ${selectedFrameworks.map((framework) => framework.id).join(", ")}`);
  log(`runtime: ${options.runtime}`);
  if (options.runtime === "docker") {
    await assertDockerAvailable();
  }
  await ensurePlaywrightBrowsers();
  const localRegistry = await prepareLocalRegistry({
    env: process.env,
    log,
    onStarted: (registry) => {
      registryProcess = registry;
    },
    paths: registryPaths,
    registryPort,
    registryUrl,
    repoRoot,
    prebuiltTarballsDir: prebuiltTarballsDir ? resolve(repoRoot, prebuiltTarballsDir) : "",
    run,
    workDir,
  });
  registryProcess = localRegistry.registry;

  if (options.runtime === "docker" && !localRuntimeImage) {
    log("building local runtime image for npx @zitadel/cli@alpha start");
    localRuntimeImage = await buildJourneyRuntimeImage();
  }

  for (const framework of selectedFrameworks) {
    frameworkContexts.push(await createFrameworkContext(framework));
  }

  if (options.suite === "testkit") {
    await runTestkitJourney(frameworkContexts[0]);
    success = true;
    log("test-kit consumer journey passed");
  } else {
    await runWithConcurrency(
      frameworkContexts,
      Math.min(options.concurrency, frameworkContexts.length),
      runFrameworkJourney,
    );

    success = true;
    log("customer local setup journey matrix passed");
  }
} catch (error) {
  await collectRegistryLogs();
  console.error("");
  console.error(`[journey-local] failed: ${errorMessage(error)}`);
  console.error(`[journey-local] diagnostics preserved in ${workDir}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  if (success && !options.keep) {
    await removeWorkDirAfterSuccess(workDir);
  } else if (success) {
    log(`kept work dir: ${workDir}`);
  }
}

process.exit(process.exitCode ?? 0);

function parseArgsOrExit(args) {
  try {
    return parseLocalJourneyArgs(args);
  } catch (error) {
    console.error(`[journey-local] ${errorMessage(error)}`);
    process.exit(1);
  }
}

function printUsage() {
  console.log(`usage: node scripts/run-local.mjs [options]

Options:
  --framework <id>         Run one framework: next, nuxt, react, vue, or angular
  --suite <id>             frameworks (default) or testkit: scaffold one next app,
                           install @zitadel/testing from the journey registry, and
                           run the checked-in consumer suite inside it
  --concurrency <n>        Number of framework journeys to run in parallel (default: 5)
  --runtime <binary|docker> Local runtime backend (default: binary)
  --image <docker-tag>     Use an existing local runtime image instead of building one
  --preset <id>            Pass a sign-in preset to setup (e.g. passkey-first)
  --preexisting-app        Seed a minimal pre-existing app before setup so the
                           scaffolded pages take the widget posture (ADR 044);
                           defaults the matrix to next and nuxt
  --tarballs-dir <path>    Use prebuilt release npm tarballs
  --keep                   Keep the temp work directory after success
  --work-dir <path>        Use an explicit work directory
`);
}

function assertMatrixPortsAreDynamic(frameworksToRun) {
  if (frameworksToRun.length <= 1) return;
  const fixedPorts = ["JOURNEY_APP_PORT", "JOURNEY_ZITADEL_PORT"].filter(
    (name) => process.env[name],
  );
  if (fixedPorts.length === 0) return;
  throw new Error(
    [
      `Cannot run the framework matrix with fixed ${fixedPorts.join(" and ")}.`,
      "Unset those variables so the runner can allocate one port per framework,",
      "or pass --framework <id> to run a single journey with fixed ports.",
    ].join(" "),
  );
}

async function createFrameworkContext(framework) {
  const frameworkWorkDir = join(workDir, framework.id);
  // The testkit suite hands the port to Playwright's webServer readiness
  // check, which refuses a port that already answers — and 3000 is the most
  // commonly squatted developer port (an IPv6-wildcard listener also slips
  // past canListen's IPv4 probe). Prefer a fresh ephemeral port there.
  const appPort = await resolveFrameworkPort(
    "JOURNEY_APP_PORT",
    options.suite === "testkit" ? undefined : 3000,
  );
  const zitadelPort = await resolveFrameworkPort("JOURNEY_ZITADEL_PORT");
  const appUrl = `http://localhost:${appPort}`;
  const appDir = join(frameworkWorkDir, "myapp");
  const playwrightRoot = join(projectRoot, "test-output", "playwright", framework.id);
  return {
    appDir,
    appPort,
    appUrl,
    diagnosticsDir: join(diagnosticsDir, framework.id),
    framework,
    frameworkWorkDir,
    logPath: join(diagnosticsDir, framework.id, `${framework.id}-app.log`),
    playwrightOutputDir: join(playwrightRoot, "output"),
    playwrightReportDir: join(playwrightRoot, "report"),
    zitadelPort,
  };
}

async function resolveFrameworkPort(envName, preferred) {
  const explicit = process.env[envName];
  if (explicit) {
    const port = validatePortValue(explicit, envName);
    if (usedPorts.has(port)) {
      throw new Error(`${envName}=${port} is already reserved by another journey service`);
    }
    usedPorts.add(port);
    return port;
  }

  if (preferred && !usedPorts.has(preferred) && (await canListen(preferred))) {
    usedPorts.add(preferred);
    return preferred;
  }

  const port = await reserveJourneyPort(usedPorts);
  usedPorts.add(port);
  return port;
}

async function runFrameworkJourney(context) {
  const { framework } = context;
  try {
    await mkdir(context.diagnosticsDir, { recursive: true });
    log(`[${framework.id}] preparing fresh ${framework.displayName} app`);
    await run("node", ["apps/cli-journey-e2e/scripts/prepare-app.mjs"], {
      env: {
        ...process.env,
        // Pin every JOURNEY_* variable prepare-app reads: a preceding CI
        // journey step exports its final values through GITHUB_ENV, so the
        // inherited process.env may carry another run's (deleted) app dir
        // or preset.
        JOURNEY_APP_DIR: context.appDir,
        JOURNEY_APP_URL: context.appUrl,
        JOURNEY_FRAMEWORK: framework.id,
        // Always explicit ("" = scaffold fresh) for the same GITHUB_ENV
        // leak-proofing as JOURNEY_PRESET above.
        JOURNEY_PREEXISTING_APP: options.preexistingApp ? "1" : "",
        JOURNEY_PRESET: options.preset,
        JOURNEY_ZITADEL_PORT: String(context.zitadelPort),
        JOURNEY_REGISTRY_URL: registryUrl,
        JOURNEY_RUNTIME: options.runtime,
        JOURNEY_WORK_DIR: context.frameworkWorkDir,
        NPM_CONFIG_USERCONFIG: registryPaths.npmrcPath,
        // The claim spec completes in the embedded console, which needs a
        // platform project (claim/complete 401s without one) and the
        // personal teams provisioned at session exchange. Framework lane
        // only — the testkit lane's contract is a scrubbed, unconfigured
        // binary. Reaches the server through prepare-app's `start` step env.
        // Deliberately NOT a `zitadel start` default: platform.bootstrap_project
        // pins the deployment's console/hosted-login default project to
        // proj_platform, which would break the standalone semantics the
        // embedded-surface suite proves.
        NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT: "true",
        ...(localRuntimeImage ? { ZITADEL_LOCAL_IMAGE: localRuntimeImage } : {}),
      },
    });

    log(`[${framework.id}] starting generated app at ${context.appUrl}`);
    const appProcess = startChild("npm", framework.devServerArgs(context.appPort), {
      cwd: context.appDir,
      env: process.env,
      logFile: context.logPath,
    });
    context.appProcess = appProcess;
    await waitForHttp(
      `${context.appUrl}${framework.readyPath}`,
      `generated ${framework.displayName} app`,
      appProcess,
      (message) => log(`[${framework.id}] ${message}`),
    );

    log(`[${framework.id}] running Playwright journey`);
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
          JOURNEY_APP_DIR: context.appDir,
          JOURNEY_APP_URL: context.appUrl,
          JOURNEY_FRAMEWORK: framework.id,
          JOURNEY_OUTPUT_DIR: context.frameworkWorkDir,
          JOURNEY_PLAYWRIGHT_OUTPUT_DIR: context.playwrightOutputDir,
          JOURNEY_PLAYWRIGHT_REPORT_DIR: context.playwrightReportDir,
          // The claim spec spawns the CLI through the journey registry, which
          // needs the same npmrc the prepare-app steps used.
          NPM_CONFIG_USERCONFIG: registryPaths.npmrcPath,
          // Always explicit ("" = default preset / fresh scaffold): see the
          // prepare-app note.
          JOURNEY_PREEXISTING_APP: options.preexistingApp ? "1" : "",
          JOURNEY_PRESET: options.preset,
        },
      },
    );
    log(`[${framework.id}] journey passed`);
  } catch (error) {
    await collectDiagnostics(context);
    throw new Error(`${framework.id}: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * The customer-configuration proof for @zitadel/testing: scaffold a fresh app
 * exactly like the framework journey, then use the kit the way its README
 * tells a customer to — install it from the registry, drop in a Playwright
 * config built on withZitadel(), and run the suite. No ZITADEL_SERVER_BINARY,
 * no NEXTGEN_* env: the CLI resolves the published binary and its embedded
 * login UI on its own.
 */
async function runTestkitJourney(context) {
  const { framework } = context;
  try {
    await mkdir(context.diagnosticsDir, { recursive: true });
    log(`[testkit] preparing fresh ${framework.displayName} app`);
    await run("node", ["apps/cli-journey-e2e/scripts/prepare-app.mjs"], {
      env: {
        ...scrubRepoOverrides(process.env),
        JOURNEY_APP_DIR: context.appDir,
        JOURNEY_APP_URL: context.appUrl,
        JOURNEY_FRAMEWORK: framework.id,
        // The testkit suite always scaffolds fresh; pin the flag off so a
        // preceding CI journey step's GITHUB_ENV export cannot leak in.
        JOURNEY_PREEXISTING_APP: "",
        JOURNEY_PRESET: options.preset,
        JOURNEY_ZITADEL_PORT: String(context.zitadelPort),
        JOURNEY_REGISTRY_URL: registryUrl,
        JOURNEY_RUNTIME: options.runtime,
        JOURNEY_WORK_DIR: context.frameworkWorkDir,
        NPM_CONFIG_USERCONFIG: registryPaths.npmrcPath,
      },
    });

    // Setup booted an instance to scaffold against; the kit suite boots its
    // own ephemeral one, so stop it and let the suite reuse the port.
    log("[testkit] stopping the setup instance");
    await runCapture("npx", cliArgs(context, ["stop"]), {
      cwd: context.appDir,
      env: scrubRepoOverrides(npxEnv(context)),
    });

    const playwrightVersion = workspacePlaywrightVersion();
    log(
      `[testkit] installing @zitadel/testing and @playwright/test@${playwrightVersion} from the journey registry`,
    );
    await run(
      "npm",
      [
        "install",
        "--save-dev",
        "--no-audit",
        "--no-fund",
        "@zitadel/testing@alpha",
        `@playwright/test@${playwrightVersion}`,
      ],
      { cwd: context.appDir, env: scrubRepoOverrides(npxEnv(context)) },
    );

    log("[testkit] copying the checked-in consumer suite into the app");
    await cp(join(projectRoot, "fixtures", "testkit"), context.appDir, { recursive: true });

    log("[testkit] running the app's @zitadel/testing suite");
    await run("npx", ["playwright", "test", "--config", "playwright.testkit.config.mts"], {
      cwd: context.appDir,
      env: {
        ...scrubRepoOverrides(npxEnv(context)),
        TESTKIT_APP_PORT: String(context.appPort),
        TESTKIT_ZITADEL_PORT: String(context.zitadelPort),
      },
    });
    log("[testkit] consumer suite passed");
  } catch (error) {
    await collectTestkitDiagnostics(context);
    throw new Error(`testkit: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * The testkit lane's contract is "the published binary works unconfigured":
 * a developer's ZITADEL_SERVER_BINARY or NEXTGEN_* exports leaking into the
 * scaffold or the inner suite would silently turn it back into an in-repo
 * run, so strip them instead of trusting the environment.
 */
function scrubRepoOverrides(env) {
  const scrubbed = { ...env };
  delete scrubbed.ZITADEL_SERVER_BINARY;
  for (const key of Object.keys(scrubbed)) {
    if (key.startsWith("NEXTGEN_")) {
      delete scrubbed[key];
    }
  }
  return scrubbed;
}

/**
 * Pin the app-local Playwright to the workspace's exact version so the inner
 * suite reuses the Chromium that ensurePlaywrightBrowsers already installed
 * instead of downloading a different revision mid-journey.
 */
function workspacePlaywrightVersion() {
  const require = createRequire(join(projectRoot, "package.json"));
  return require("@playwright/test/package.json").version;
}

async function collectTestkitDiagnostics(context) {
  await collectDiagnostics(context);
  await copyIfExists(
    join(context.appDir, "playwright-report"),
    join(context.diagnosticsDir, "testkit-playwright-report"),
  );
  await copyIfExists(
    join(context.appDir, "test-results"),
    join(context.diagnosticsDir, "testkit-test-results"),
  );
}

async function runWithConcurrency(items, limit, worker) {
  const errors = [];
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      try {
        await worker(item);
      } catch (error) {
        errors.push(error);
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runNext()));
  if (errors.length > 0) {
    throw new Error(errors.map(errorMessage).join("\n"));
  }
}

async function resolvePort(envName) {
  const value = process.env[envName];
  if (value) {
    return validatePortValue(value, envName);
  }
  return reserveJourneyPort(usedPorts);
}

function validatePortValue(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a TCP port, got ${value}`);
  }
  return port;
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

  try {
    const result = await runCapture("docker", ["info", "--format", "{{.ServerVersion}}"]);
    engineVersion = result.stdout.trim();
  } catch (error) {
    throw new Error(
      [
        "Docker is required for the Docker local runtime journey.",
        "Start Docker Desktop or another Docker daemon, wait until `docker ps` works, then rerun this command.",
        `Docker daemon check failed: ${commandErrorDetail(error)}`,
      ].join("\n"),
      { cause: error },
    );
  }

  log(`Docker is available${engineVersion ? ` (engine ${engineVersion})` : ""}`);
}

function startChild(command, args, optionsForChild) {
  const output = createWriteStream(optionsForChild.logFile, { flags: "a" });
  const child = spawn(command, args, {
    cwd: optionsForChild.cwd,
    detached: process.platform !== "win32",
    env: optionsForChild.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.detachedForCleanup = process.platform !== "win32";
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

async function collectDiagnostics(context) {
  if (context.diagnosticsCollected) return;
  context.diagnosticsCollected = true;

  await mkdir(context.diagnosticsDir, { recursive: true });
  await collectLocalRuntimeLogs(context);
  await copyIfExists(context.logPath, join(context.diagnosticsDir, `${context.framework.id}-app.log`));
  await copyIfExists(join(context.frameworkWorkDir, "doctor.json"), join(context.diagnosticsDir, "doctor.json"));
  await copyIfExists(
    join(context.frameworkWorkDir, "doctor.stderr.log"),
    join(context.diagnosticsDir, "doctor.stderr.log"),
  );
  await copyIfExists(join(context.frameworkWorkDir, "start.json"), join(context.diagnosticsDir, "start.json"));
  await copyIfExists(
    join(context.frameworkWorkDir, "start.stderr.log"),
    join(context.diagnosticsDir, "start.stderr.log"),
  );
  await copyIfExists(join(context.frameworkWorkDir, "setup.json"), join(context.diagnosticsDir, "setup.json"));
  await copyIfExists(
    join(context.frameworkWorkDir, "setup.stderr.log"),
    join(context.diagnosticsDir, "setup.stderr.log"),
  );
  await copyIfExists(join(context.frameworkWorkDir, "metadata.json"), join(context.diagnosticsDir, "metadata.json"));
  await copyIfExists(join(context.frameworkWorkDir, "logs.json"), join(context.diagnosticsDir, "logs.json"));
  await copyIfExists(
    join(context.frameworkWorkDir, "logs.stderr.log"),
    join(context.diagnosticsDir, "logs.stderr.log"),
  );
  await copyIfExists(
    join(context.appDir, ".zitadel/local/runtime.json"),
    join(context.diagnosticsDir, "runtime.json"),
  );
  await copyIfExists(
    join(context.appDir, ".zitadel/local/server.log"),
    join(context.diagnosticsDir, "server.log"),
  );
  await mkdir(join(context.diagnosticsDir, "generated-app"), { recursive: true });
  await copyIfExists(
    join(context.appDir, "package.json"),
    join(context.diagnosticsDir, "generated-app", "package.json"),
  );
  await copyIfExists(
    join(context.appDir, "package-lock.json"),
    join(context.diagnosticsDir, "generated-app", "package-lock.json"),
  );
  await copyIfExists(
    join(context.appDir, "pnpm-lock.yaml"),
    join(context.diagnosticsDir, "generated-app", "pnpm-lock.yaml"),
  );
  await copyIfExists(context.playwrightReportDir, join(context.diagnosticsDir, "playwright-report"));
  await copyIfExists(context.playwrightOutputDir, join(context.diagnosticsDir, "playwright-output"));
}

async function collectRegistryLogs() {
  if (registryLogsCollected) return;
  registryLogsCollected = true;
  await mkdir(diagnosticsDir, { recursive: true });
  await copyIfExists(registryPaths.registryLogPath, join(diagnosticsDir, "verdaccio.log"));
}

async function collectLocalRuntimeLogs(context) {
  try {
    const result = await runCapture("npx", cliArgs(context, ["logs", "--tail", "400"]), {
      cwd: context.appDir,
      env: npxEnv(context),
    });
    await writeFile(join(context.diagnosticsDir, "logs.json"), result.stdout);
    await writeFile(join(context.diagnosticsDir, "logs.stderr.log"), result.stderr);
  } catch (error) {
    await writeFile(
      join(context.diagnosticsDir, "logs.stderr.log"),
      `failed to collect local runtime logs: ${errorMessage(error)}\n`,
    );
  }
}

async function copyIfExists(source, destination) {
  if (resolve(source) === resolve(destination)) return;
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

  await Promise.all(frameworkContexts.map(resetLocalRuntime));

  if (registryProcess) {
    try {
      await stopLocalRegistry(registryProcess);
    } catch (error) {
      console.error(`[journey-local] Verdaccio cleanup failed: ${errorMessage(error)}`);
    }
  }
}

async function resetLocalRuntime(context) {
  try {
    await runCapture("npx", cliArgs(context, ["reset", "--force"]), {
      cwd: context.appDir,
      env: npxEnv(context),
    });
  } catch (error) {
    console.error(
      `[journey-local] ${context.framework.id} local runtime reset failed: ${errorMessage(error)}`,
    );
  }
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  signalChild(child, "SIGTERM");
  const exited = await waitForExit(child, 5000);
  if (!exited && child.exitCode === null) {
    signalChild(child, "SIGKILL");
    await waitForExit(child, 5000);
  }
}

function signalChild(child, signal) {
  try {
    if (child.detachedForCleanup && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    if (!isErrno(error, "ESRCH")) {
      throw error;
    }
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

async function removeWorkDirAfterSuccess(path) {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (error) {
    console.error(`[journey-local] cleanup left work dir ${path}: ${errorMessage(error)}`);
  }
}

async function handleSignal(signal) {
  console.error(`[journey-local] received ${signal}, cleaning up`);
  await collectRegistryLogs();
  await Promise.all(frameworkContexts.map(collectDiagnostics));
  await cleanup();
  process.exit(130);
}

function cliArgs(context, args) {
  return [
    "--yes",
    `${cliPackage}@alpha`,
    ...args,
    "--cwd",
    context.appDir,
    "--non-interactive",
    "--json",
  ];
}

function npxEnv(context) {
  const env = npmEnvironment(process.env, registryUrl, registryPaths.npmrcPath);
  env.JOURNEY_RUNTIME = options.runtime;
  env.npm_config_cache = join(context.frameworkWorkDir, ".npm-cache");
  env.npm_config_tmp = join(context.frameworkWorkDir, ".npm-tmp");
  const image = options.runtime === "docker" ? localRuntimeImage || process.env.ZITADEL_LOCAL_IMAGE : "";
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

function isErrno(error, code) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
