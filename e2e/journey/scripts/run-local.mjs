import { createWriteStream, existsSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { ciFrameworkIds, frameworkForId } from "./frameworks.mjs";
import { remoteHostEnv, startHttpsEdge } from "./https-edge.mjs";
import { errorMessage, packageName, parsePort } from "./lib.mjs";
import {
  localRegistryPaths,
  npmEnvironment,
  prepareLocalRegistry,
  stopLocalRegistry,
  waitForHttp,
} from "./local-registry.mjs";
import {
  OIDC_MOCK_CLIENT_ID,
  OIDC_MOCK_CLIENT_SECRET,
  OIDC_MOCK_REDIRECT_PATH,
} from "./oidc-mock.mjs";
import { canListen, createJourneyPortAllocator } from "./ports.mjs";
import {
  assertOidcMock,
  assertPrebuiltTarballs,
  journeyArgsFromEnv,
  parseLocalJourneyArgs,
} from "./run-options.mjs";
import {
  formatMarkdownTable,
  formatOffset,
  formatPhases,
  formatTextTable,
  readPhases,
  timePhase,
  timingTable,
} from "./timings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const repoRoot = resolve(projectRoot, "../..");
// Where `moon run oidc-mock:build` writes the mock OIDC provider.
const oidcMockBinary = join(repoRoot, "tools/oidc-mock/dist/oidc-mock");

const options = parseArgsOrExit([...journeyArgsFromEnv(process.env), ...process.argv.slice(2)]);
if (options.help) {
  printUsage();
  process.exit(0);
}

// A "journey variant" is one unit of work: a suite/preset/pre-existing-app
// posture and the frameworks it runs. Non-CI derives a single variant from the
// parsed options; `--ci` runs the fixed CI set (fresh-app matrix, passkey
// preset, pre-existing app, testkit, remote https) in this one process so they
// share the module-level `usedPorts` and never need cross-process port juggling.
const journeyVariants = buildJourneyVariants();
const plannedRuns = journeyVariants.flatMap((variant) =>
  variant.frameworkIds.map((id) => ({ variant, framework: frameworkForId(id) })),
);
const workDir = resolve(
  options.workDir || (await mkdtemp(join(tmpdir(), "zitadel-cli-journey-local-"))),
);
const diagnosticsDir = join(workDir, "diagnostics");
const registryPaths = localRegistryPaths(workDir);
// CI points Verdaccio's storage at a path it caches between runs, so the public
// framework packages every scaffold pulls through the npmjs uplink are not
// re-downloaded on every run. Unset (local dev) keeps the ephemeral per-run
// store that is wiped with the work dir.
const persistentRegistryStorage = process.env.JOURNEY_REGISTRY_STORAGE;
if (persistentRegistryStorage) {
  registryPaths.storagePath = resolve(persistentRegistryStorage);
}
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
const journeyContexts = [];
// What every lane waits for (browsers, registry, Docker image); the lanes'
// own phases live on their contexts. Both feed the closing timing table.
const sharedPhases = [];
const prebuiltTarballsDir = options.tarballsDir;
let registryProcess;
let registryLogsCollected = false;
let cleanupStarted = false;
let success = false;
let localRuntimeImage =
  options.runtime === "docker" ? process.env.ZITADEL_LOCAL_IMAGE || options.image : "";

process.on("SIGINT", () => void handleSignal("SIGINT"));
process.on("SIGTERM", () => void handleSignal("SIGTERM"));

try {
  assertMatrixPortsAreDynamic(plannedRuns);
  await mkdir(diagnosticsDir, { recursive: true });

  log(`work dir: ${workDir}`);
  log(
    `journeys: ${plannedRuns
      .map(({ variant, framework }) => `${variant.id}/${framework.id}`)
      .join(", ")}`,
  );
  log(`runtime: ${options.runtime}`);
  if (!existsSync(oidcMockBinary)) {
    log("no mock OIDC provider binary (moon run oidc-mock:build); the specs that need it skip");
  }
  if (options.runtime === "docker") {
    await assertDockerAvailable();
  }
  await timePhase(sharedPhases, "browsers", ensurePlaywrightBrowsers);
  const localRegistry = await timePhase(sharedPhases, "registry", () =>
    prepareLocalRegistry({
      env: process.env,
      log,
      onStarted: (registry) => {
        registryProcess = registry;
      },
      paths: registryPaths,
      registryPort,
      registryUrl,
      repoRoot,
      resetStorage: !persistentRegistryStorage,
      prebuiltTarballsDir: prebuiltTarballsDir ? resolve(repoRoot, prebuiltTarballsDir) : "",
      run,
      workDir,
    }),
  );
  registryProcess = localRegistry.registry;

  if (options.runtime === "docker" && !localRuntimeImage) {
    log("building local runtime image for npx @zitadel/cli@alpha start");
    localRuntimeImage = await timePhase(sharedPhases, "image", buildJourneyRuntimeImage);
  }

  // Resolve every (variant, framework) port sequentially so the shared
  // `usedPorts` set settles before any journey starts: the first context that
  // prefers 3000 takes it and the rest fall through to the allocator.
  for (const { variant, framework } of plannedRuns) {
    journeyContexts.push(await createJourneyContext(variant, framework));
  }

  await runWithConcurrency(
    journeyContexts,
    Math.min(options.concurrency, journeyContexts.length),
    runJourney,
  ).finally(reportTimings);

  success = true;
  log("customer local setup journey matrix passed");
} catch (error) {
  await collectRegistryLogs();
  console.error("");
  console.error(`${stamp()} failed: ${errorMessage(error)}`);
  console.error(`${stamp()} diagnostics preserved in ${workDir}`);
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
    const parsed = parseLocalJourneyArgs(args);
    if (!parsed.help) {
      assertPrebuiltTarballs(parsed, process.env);
      assertOidcMock(parsed, oidcMockBinary);
    }
    return parsed;
  } catch (error) {
    console.error(`${stamp()} ${errorMessage(error)}`);
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
  --ci                     Run the full CI journey set (fresh-app matrix,
                           passkey preset, pre-existing app, testkit, remote
                           https) in one process; incompatible with
                           --framework/--suite/--preset/--preexisting-app/--remote
  --matrix <single|full>   Fresh-app framework scope under --ci (default: full)
  --concurrency <n>        Number of framework journeys to run in parallel (default: 5)
  --runtime <binary|docker> Local runtime backend (default: binary)
  --image <docker-tag>     Use an existing local runtime image instead of building one
  --preset <id>            Pass a sign-in preset to setup (e.g. passkey-first)
  --preexisting-app        Seed a minimal pre-existing app before setup so the
                           scaffolded pages take the widget posture (ADR 044);
                           defaults the matrix to next and nuxt
  --remote                 Set up against a local https edge for zitadel.test
                           (scripts/https-edge.mjs) in front of the local
                           runtime, instead of --server local: the generated
                           app then reaches its server the way it reaches a
                           hosted deployment
  --tarballs-dir <path>    Use prebuilt release npm tarballs
  --keep                   Keep the temp work directory after success
  --work-dir <path>        Use an explicit work directory

Environment (the command line's arguments win):
  JOURNEY_CI=1             --ci
  JOURNEY_CONCURRENCY      --concurrency
  JOURNEY_MATRIX           --matrix
  JOURNEY_RUNTIME          --runtime
  JOURNEY_TARBALLS_DIR     --tarballs-dir
  JOURNEY_WORK_DIR         --work-dir
  JOURNEY_TARBALLS_REQUIRED=1  refuse to pack without --tarballs-dir
`);
}

function buildJourneyVariants() {
  if (!options.ci) {
    return [
      {
        id: "journey",
        suite: options.suite,
        preset: options.preset,
        preexistingApp: options.preexistingApp,
        remote: options.remote,
        frameworkIds: options.frameworkIds,
      },
    ];
  }
  return [
    {
      id: "fresh-app",
      suite: "frameworks",
      preset: "",
      preexistingApp: false,
      remote: false,
      frameworkIds: options.matrix === "single" ? ["next"] : [...ciFrameworkIds],
    },
    {
      id: "passkey",
      suite: "frameworks",
      preset: "passkey-first",
      preexistingApp: false,
      remote: false,
      frameworkIds: ["next"],
    },
    {
      id: "preexisting",
      suite: "frameworks",
      preset: "",
      preexistingApp: true,
      remote: false,
      frameworkIds: ["next", "nuxt"],
    },
    {
      id: "testkit",
      suite: "testkit",
      preset: "",
      preexistingApp: false,
      remote: false,
      frameworkIds: ["next"],
    },
    // The scaffolded dev proxy against an https server that answers only to
    // its own name, as the hosted cloud does. React stands for the shared
    // Vite proxy; passkey-first because the passkey ceremony depends most on
    // the server seeing the app's origin.
    {
      id: "remote",
      suite: "frameworks",
      preset: "passkey-first",
      preexistingApp: false,
      remote: true,
      frameworkIds: ["react"],
    },
  ];
}

function assertMatrixPortsAreDynamic(runsToRun) {
  if (runsToRun.length <= 1) return;
  const fixedPorts = [
    "JOURNEY_APP_PORT",
    "JOURNEY_ZITADEL_PORT",
    "JOURNEY_EDGE_PORT",
    "JOURNEY_OIDC_MOCK_PORT",
  ].filter((name) => process.env[name]);
  if (fixedPorts.length === 0) return;
  throw new Error(
    [
      `Cannot run the framework matrix with fixed ${fixedPorts.join(" and ")}.`,
      "Unset those variables so the runner can allocate one port per framework,",
      "or pass --framework <id> to run a single journey with fixed ports.",
    ].join(" "),
  );
}

async function createJourneyContext(variant, framework) {
  // Namespace every per-run path by variant id so two variants that use the
  // same framework (e.g. fresh-app/next and passkey/next) never collide on
  // disk or in Playwright output.
  const frameworkWorkDir = join(workDir, variant.id, framework.id);
  const contextDiagnosticsDir = join(diagnosticsDir, variant.id, framework.id);
  // The testkit suite hands the port to Playwright's webServer readiness
  // check, which refuses a port that already answers — and 3000 is the most
  // commonly squatted developer port (an IPv6-wildcard listener also slips
  // past canListen's IPv4 probe). Prefer a fresh ephemeral port there.
  const appPort = await resolveFrameworkPort(
    "JOURNEY_APP_PORT",
    variant.suite === "testkit" ? undefined : 3000,
  );
  const zitadelPort = await resolveFrameworkPort("JOURNEY_ZITADEL_PORT");
  const edgePort = variant.remote ? await resolveFrameworkPort("JOURNEY_EDGE_PORT") : undefined;
  // The testkit lane boots its own instance and never talks to the mock. A
  // docker runtime cannot reach a mock that listens on the host only.
  const oidcMockPort =
    variant.suite !== "testkit" && options.runtime !== "docker" && existsSync(oidcMockBinary)
      ? await resolveFrameworkPort("JOURNEY_OIDC_MOCK_PORT")
      : undefined;
  const appUrl = `http://localhost:${appPort}`;
  const appDir = join(frameworkWorkDir, "myapp");
  const playwrightRoot = join(projectRoot, "test-output", "playwright", variant.id, framework.id);
  return {
    appDir,
    appPort,
    appUrl,
    diagnosticsDir: contextDiagnosticsDir,
    edgePort,
    framework,
    frameworkWorkDir,
    logPath: join(contextDiagnosticsDir, `${framework.id}-app.log`),
    oidcMockPort,
    playwrightOutputDir: join(playwrightRoot, "output"),
    playwrightReportDir: join(playwrightRoot, "report"),
    preexistingApp: variant.preexistingApp,
    preset: variant.preset,
    remote: variant.remote,
    suite: variant.suite,
    // The lane's row in the closing timing table, filled in as it runs.
    timing: { id: `${variant.id}/${framework.id}`, phases: [] },
    variantId: variant.id,
    zitadelPort,
  };
}

async function resolveFrameworkPort(envName, preferred) {
  const explicit = process.env[envName];
  if (explicit) {
    const port = parsePort(explicit, envName);
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

/** One lane of the pool, timed for the closing table from start to teardown. */
async function runJourney(context) {
  const { timing } = context;
  timing.began = performance.now();
  try {
    await (context.suite === "testkit" ? runTestkitJourney(context) : runFrameworkJourney(context));
  } catch (error) {
    timing.failed = true;
    throw error;
  } finally {
    // Release this lane's app server and runtime as soon as it finishes, so a
    // full run never holds more than `concurrency` of them alive at once.
    await timePhase(timing.phases, "teardown", () => teardownJourney(context));
    timing.ended = performance.now();
  }
}

async function runFrameworkJourney(context) {
  const { framework } = context;
  const prefix = `${context.variantId}/${framework.id}`;
  const timed = (phase, fn) => timePhase(context.timing.phases, phase, fn);
  try {
    await mkdir(context.diagnosticsDir, { recursive: true });
    const edge = context.remote ? await startLaneEdge(context, prefix) : undefined;
    if (context.oidcMockPort) {
      await timed("oidc-mock", () => startLaneOidcMock(context, prefix));
    }
    log(`[${prefix}] preparing fresh ${framework.displayName} app`);
    await runPrepareApp(context, {
      ...process.env,
      // The CLI reaches the edge by name: preloaded resolver, trusted cert.
      ...edge?.env,
      // Pin every JOURNEY_* variable prepare-app reads: a preceding CI
      // journey step exports its final values through GITHUB_ENV, so the
      // inherited process.env may carry another run's (deleted) app dir
      // or preset.
      JOURNEY_APP_DIR: context.appDir,
      JOURNEY_APP_URL: context.appUrl,
      JOURNEY_FRAMEWORK: framework.id,
      // Always explicit ("" = scaffold fresh) for the same GITHUB_ENV
      // leak-proofing as JOURNEY_PRESET above.
      JOURNEY_PREEXISTING_APP: context.preexistingApp ? "1" : "",
      JOURNEY_PRESET: context.preset,
      JOURNEY_SUITE: context.suite,
      // What setup's --server points at: the local runtime, or the remote
      // lane's https edge in front of it.
      JOURNEY_SETUP_SERVER: edge?.url ?? "local",
      JOURNEY_ZITADEL_PORT: String(context.zitadelPort),
      JOURNEY_REGISTRY_URL: registryUrl,
      JOURNEY_RUNTIME: options.runtime,
      JOURNEY_WORK_DIR: context.frameworkWorkDir,
      NPM_CONFIG_USERCONFIG: registryPaths.npmrcPath,
      // The claim spec needs a platform project (claim/complete 401s without
      // one) and the personal teams provisioned at session exchange.
      // `zitadel start` now opts in by itself, so this is belt and braces for
      // the framework lane, and it keeps the intent explicit here. Reaches
      // the server through prepare-app's `start` step env.
      NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT: "true",
      // The server's egress client refuses loopback hosts by default, and the
      // mock OIDC provider runs on localhost. The testkit lane does not set it.
      NEXTGEN_HTTPCLIENT_ALLOW_LIST: "localhost,127.0.0.0/8,::1/128",
      ...(localRuntimeImage ? { ZITADEL_LOCAL_IMAGE: localRuntimeImage } : {}),
    });

    log(`[${prefix}] starting generated app at ${context.appUrl}`);
    await timed("app", () => {
      const appProcess = startChild("npm", framework.devServerArgs(context.appPort), {
        cwd: context.appDir,
        // The app's dev proxy reaches the edge by name, like the CLI did.
        env: edge ? { ...process.env, ...edge.env } : process.env,
        logFile: context.logPath,
      });
      context.appProcess = appProcess;
      return waitForHttp(
        `${context.appUrl}${framework.readyPath}`,
        `generated ${framework.displayName} app`,
        appProcess,
        (message) => log(`[${prefix}] ${message}`),
      );
    });

    log(`[${prefix}] running Playwright journey`);
    await timed("playwright", () =>
      run(
        "corepack",
        [
          "pnpm",
          "--filter",
          "@zitadel/e2e",
          "exec",
          "playwright",
          "test",
          "--config",
          "journey/playwright.config.mts",
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
            JOURNEY_PREEXISTING_APP: context.preexistingApp ? "1" : "",
            JOURNEY_PRESET: context.preset,
            // Always explicit ("" = no mock in this lane): the specs that
            // sign in through the mock skip without it.
            JOURNEY_OIDC_MOCK_URL: context.oidcMock?.issuer ?? "",
          },
        },
      ),
    );
    log(`[${prefix}] journey passed`);
  } catch (error) {
    await collectDiagnostics(context);
    throw new Error(`${prefix}: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Runs prepare-app for a lane and adds the CLI steps it timed to the lane's
 * phases, also when one of them failed: the table then shows how far it got.
 */
async function runPrepareApp(context, env) {
  const timingsPath = join(context.frameworkWorkDir, "timings.json");
  // A kept work dir may still hold an earlier run's.
  await rm(timingsPath, { force: true });
  try {
    await run("node", ["e2e/journey/scripts/prepare-app.mjs"], { env });
  } finally {
    context.timing.phases.push(...(await readPhases(timingsPath)));
  }
}

/**
 * Starts the remote lane's https edge in front of the lane's local runtime,
 * which `zitadel start` brings up during prepare-app; until then the edge
 * answers 502. The edge logs to the lane's diagnostics; teardownJourney
 * closes it.
 */
async function startLaneEdge(context, prefix) {
  await mkdir(context.frameworkWorkDir, { recursive: true });
  const edge = await startHttpsEdge({
    port: context.edgePort,
    upstreamPort: context.zitadelPort,
    dir: context.frameworkWorkDir,
    logPath: join(context.diagnosticsDir, "edge.log"),
  });
  context.edge = edge;
  log(
    `[${prefix}] https edge ${edge.url} in front of the local runtime on :${context.zitadelPort}`,
  );
  return {
    url: edge.url,
    env: remoteHostEnv({ certPath: edge.certPath, dir: context.frameworkWorkDir }),
  };
}

/**
 * Starts the mock OIDC provider (tools/oidc-mock) for a framework lane, with
 * the lane's app callback as its redirect URI; teardownJourney stops it.
 */
async function startLaneOidcMock(context, prefix) {
  await mkdir(context.frameworkWorkDir, { recursive: true });
  // 127.0.0.1, not localhost: the mock listens there only, and the hop back
  // to the app on localhost must be cross-site, as from a real provider. The
  // trailing slash is part of the issuer the relying party compares.
  const issuer = `http://127.0.0.1:${context.oidcMockPort}/`;
  const child = startChild(oidcMockBinary, [], {
    cwd: context.frameworkWorkDir,
    env: {
      ...process.env,
      PORT: String(context.oidcMockPort),
      ISSUER: issuer,
      REDIRECT_URI: `${context.appUrl}${OIDC_MOCK_REDIRECT_PATH}`,
      USERS_FILE: join(repoRoot, "tools/oidc-mock/users.json"),
      CLIENT_ID: OIDC_MOCK_CLIENT_ID,
      CLIENT_SECRET: OIDC_MOCK_CLIENT_SECRET,
    },
    logFile: join(context.diagnosticsDir, "oidc-mock.log"),
  });
  context.oidcMock = { child, issuer };
  await waitForHttp(
    `${issuer}.well-known/openid-configuration`,
    "mock OIDC provider",
    child,
    (message) => log(`[${prefix}] ${message}`),
  );
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
  const prefix = `${context.variantId}/${framework.id}`;
  const timed = (phase, fn) => timePhase(context.timing.phases, phase, fn);
  try {
    await mkdir(context.diagnosticsDir, { recursive: true });
    log(`[${prefix}] preparing fresh ${framework.displayName} app`);
    await runPrepareApp(context, {
      ...scrubRepoOverrides(process.env),
      JOURNEY_APP_DIR: context.appDir,
      JOURNEY_APP_URL: context.appUrl,
      JOURNEY_FRAMEWORK: framework.id,
      // The testkit suite always scaffolds fresh; pin the flag off so a
      // preceding CI journey step's GITHUB_ENV export cannot leak in.
      JOURNEY_PREEXISTING_APP: "",
      JOURNEY_PRESET: context.preset,
      // Skips the scaffold checks only the journey specs read.
      JOURNEY_SUITE: context.suite,
      JOURNEY_ZITADEL_PORT: String(context.zitadelPort),
      JOURNEY_REGISTRY_URL: registryUrl,
      JOURNEY_RUNTIME: options.runtime,
      JOURNEY_WORK_DIR: context.frameworkWorkDir,
      NPM_CONFIG_USERCONFIG: registryPaths.npmrcPath,
    });

    // Setup booted an instance to scaffold against; the kit suite boots its
    // own ephemeral one, so stop it and let the suite reuse the port.
    log(`[${prefix}] stopping the setup instance`);
    await timed("stop", () =>
      runCapture("npx", cliArgs(context, ["stop"]), {
        cwd: context.appDir,
        env: scrubRepoOverrides(npxEnv(context)),
      }),
    );

    const playwrightVersion = workspacePlaywrightVersion();
    log(
      `[${prefix}] installing @zitadel/testing and @playwright/test@${playwrightVersion} from the journey registry`,
    );
    await timed("install", () =>
      run(
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
      ),
    );

    log(`[${prefix}] copying the checked-in consumer suite into the app`);
    await cp(join(projectRoot, "fixtures", "testkit"), context.appDir, { recursive: true });

    log(`[${prefix}] running the app's @zitadel/testing suite`);
    await timed("playwright", () =>
      run("npx", ["playwright", "test", "--config", "playwright.testkit.config.mts"], {
        cwd: context.appDir,
        env: {
          ...scrubRepoOverrides(npxEnv(context)),
          TESTKIT_APP_PORT: String(context.appPort),
          TESTKIT_ZITADEL_PORT: String(context.zitadelPort),
        },
      }),
    );
    log(`[${prefix}] consumer suite passed`);
  } catch (error) {
    await collectTestkitDiagnostics(context);
    throw new Error(`${prefix}: ${errorMessage(error)}`, { cause: error });
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

/**
 * Prints the lane × phase table (timings.mjs) once the pool has settled,
 * passed or failed, and adds it to the job summary when running in GitHub
 * Actions.
 */
async function reportTimings() {
  const rows = timingTable(journeyContexts.map((context) => context.timing));
  const shared = formatPhases(sharedPhases);
  log(`phase timings in seconds (began: the lane's start); before the lanes: ${shared}`);
  console.log(formatTextTable(rows));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const summary = [
    "### Journey phase timings",
    "",
    `Seconds per phase. *began* is when the lane started, counted from the runner's start. Before the lanes: ${shared}.`,
    "",
    formatMarkdownTable(rows),
    "",
  ];
  try {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
  } catch (error) {
    console.error(
      `${stamp()} could not add the timings to the job summary: ${errorMessage(error)}`,
    );
  }
}

async function resolvePort(envName) {
  const value = process.env[envName];
  if (value) {
    return parsePort(value, envName);
  }
  return reserveJourneyPort(usedPorts);
}

async function ensurePlaywrightBrowsers() {
  log("ensuring Playwright Chromium browsers are installed");
  await run("corepack", [
    "pnpm",
    "--filter",
    "@zitadel/e2e",
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
  // waitForHttp reports a binary that could not start.
  child.on("error", (error) => {
    child.spawnError = error;
  });
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
  await copyIfExists(
    context.logPath,
    join(context.diagnosticsDir, `${context.framework.id}-app.log`),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "doctor.json"),
    join(context.diagnosticsDir, "doctor.json"),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "doctor.stderr.log"),
    join(context.diagnosticsDir, "doctor.stderr.log"),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "start.json"),
    join(context.diagnosticsDir, "start.json"),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "start.stderr.log"),
    join(context.diagnosticsDir, "start.stderr.log"),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "setup.json"),
    join(context.diagnosticsDir, "setup.json"),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "setup.stderr.log"),
    join(context.diagnosticsDir, "setup.stderr.log"),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "metadata.json"),
    join(context.diagnosticsDir, "metadata.json"),
  );
  await copyIfExists(
    join(context.frameworkWorkDir, "logs.json"),
    join(context.diagnosticsDir, "logs.json"),
  );
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
  await copyIfExists(
    context.playwrightReportDir,
    join(context.diagnosticsDir, "playwright-report"),
  );
  await copyIfExists(
    context.playwrightOutputDir,
    join(context.diagnosticsDir, "playwright-output"),
  );
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

  await Promise.all(journeyContexts.map(teardownJourney));

  if (registryProcess) {
    try {
      await stopLocalRegistry(registryProcess);
    } catch (error) {
      console.error(`${stamp()} Verdaccio cleanup failed: ${errorMessage(error)}`);
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
      `${stamp()} ${context.framework.id} local runtime reset failed: ${errorMessage(error)}`,
    );
  }
}

// Stop a finished lane's app server and reset its runtime. Called from each
// worker's finally so services don't accumulate past the concurrency limit;
// cleanup() calls it too for any lane cut short by a failure or signal. The
// `toreDown` guard keeps it idempotent across both callers.
async function teardownJourney(context) {
  if (context.toreDown) return;
  context.toreDown = true;
  if (context.appProcess) {
    await stopChild(context.appProcess);
  }
  if (context.edge) {
    await context.edge.close();
  }
  if (context.oidcMock) {
    await stopChild(context.oidcMock.child);
  }
  await resetLocalRuntime(context);
}

// A child killed by a signal keeps exitCode null and sets signalCode instead.
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalChild(child, "SIGTERM");
  const exited = await waitForExit(child, 5000);
  if (!exited && child.exitCode === null && child.signalCode === null) {
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
    if (child.exitCode !== null || child.signalCode !== null) {
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
    console.error(`${stamp()} cleanup left work dir ${path}: ${errorMessage(error)}`);
  }
}

async function handleSignal(signal) {
  console.error(`${stamp()} received ${signal}, cleaning up`);
  await collectRegistryLogs();
  await Promise.all(journeyContexts.map(collectDiagnostics));
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
  const image =
    options.runtime === "docker" ? localRuntimeImage || process.env.ZITADEL_LOCAL_IMAGE : "";
  if (image) {
    env.ZITADEL_LOCAL_IMAGE = image;
  }
  return env;
}

function log(message) {
  console.log(`${stamp()} ${message}`);
}

/**
 * The tag on every runner line, with the time since the runner started: a task
 * runner may print a task's output only once it ends, all lines under one
 * timestamp, so the line carries its own.
 */
function stamp() {
  return `[journey-local ${formatOffset(performance.now())}]`;
}

function isErrno(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
