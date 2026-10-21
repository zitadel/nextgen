import { existsSync } from "node:fs";

import { frameworkForId, frameworkIds } from "./frameworks.mjs";

// The pre-existing-app lane covers the widget posture (ADR 044), which is
// scoped to the route-based frameworks: only their patchers leave the host
// app a shell for the widget to embed into. Mirrors ROUTE_BASED_FRAMEWORKS
// in apps/cli/src/lib/orca/patchers/posture.ts.
const PREEXISTING_FRAMEWORK_IDS = ["next", "nuxt"];

// The options CI sets, as environment variables beside the arguments. CI's
// turbo job cannot pass them after `--`: turbo puts those arguments into the
// cache key of every task in the run (vercel/turborepo#14770), so the
// runner's dependencies would be rebuilt instead of restored. ci.yml cannot
// either: it runs the journey as a dependency of `e2e:all`, whose command
// moon fixes.
const ENV_VALUE_OPTIONS = [
  ["JOURNEY_CONCURRENCY", "--concurrency"],
  ["JOURNEY_MATRIX", "--matrix"],
  ["JOURNEY_RUNTIME", "--runtime"],
  ["JOURNEY_TARBALLS_DIR", "--tarballs-dir"],
  ["JOURNEY_WORK_DIR", "--work-dir"],
];

/**
 * The arguments the JOURNEY_* variables stand for (`JOURNEY_CI=1` is
 * `--ci`). They go in front of the command line's own arguments, which win.
 */
export function journeyArgsFromEnv(env) {
  const args = env.JOURNEY_CI === "1" ? ["--ci"] : [];
  for (const [name, flag] of ENV_VALUE_OPTIONS) {
    if (env[name]) {
      args.push(flag, env[name]);
    }
  }
  return args;
}

/**
 * Packing the tarballs takes a `moon run release:pack` of the runner's own: a
 * second moon graph, whose release builds wipe and rebuild the dist folders of
 * the CLI, the SDKs, the test kit and the console. Inside a workflow it races
 * the graph that runs the journey (its build tasks rewrite the dist folders
 * being packed), and in `e2e:all` it races the lanes beside the journey, which
 * read those folders. So there the caller hands over prebuilt tarballs, and a
 * run without them stops here. The moon task unsets CI and GITHUB_ACTIONS, so
 * GITHUB_RUN_ID is what tells a workflow run apart; the e2e:all lane sets
 * JOURNEY_TARBALLS_REQUIRED.
 */
export function assertPrebuiltTarballs(options, env) {
  if (options.tarballsDir) {
    return;
  }
  if (env.GITHUB_RUN_ID) {
    throw new Error(
      "in GitHub Actions the workflow must hand the journey prebuilt tarballs " +
        "(JOURNEY_TARBALLS_DIR or --tarballs-dir); packing them here would start " +
        "a second moon graph inside the running one",
    );
  }
  if (env.JOURNEY_TARBALLS_REQUIRED === "1") {
    throw new Error(
      "e2e:journey-local runs beside the other e2e lanes, and packing its own " +
        "tarballs would rebuild the dist folders they read. Pack them first " +
        "(`moon run release:pack`) and hand them over with " +
        "JOURNEY_TARBALLS_DIR=dist/release/<version>/npm, or run the journey " +
        "alone with `moon run e2e:journey -- --ci`, which packs its own",
    );
  }
}

/**
 * The framework lanes start the mock OIDC provider (tools/oidc-mock) when
 * `moon run oidc-mock:build` has built it; run by hand without it, the specs
 * that need it skip themselves. Under --ci a missing binary stops the run, so
 * those specs never skip silently there.
 */
export function assertOidcMock(options, binary) {
  if (options.ci && !existsSync(binary)) {
    throw new Error(
      `the mock OIDC provider binary is missing (${binary}); ` +
        "build it with `moon run oidc-mock:build`",
    );
  }
}

export function parseLocalJourneyArgs(args) {
  const parsed = {
    ci: false,
    concurrency: 5,
    frameworkIds: [...frameworkIds],
    image: "",
    keep: false,
    matrix: "full",
    preexistingApp: false,
    preset: "",
    remote: false,
    runtime: "binary",
    suite: "frameworks",
    tarballsDir: "",
    workDir: "",
  };
  let explicitFramework = false;
  let explicitSuite = false;
  let explicitPreset = false;
  let explicitMatrix = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      // A bare separator survives some `pnpm run` forwarding; skip it.
      case "--": {
        break;
      }
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
      case "--ci": {
        parsed.ci = true;
        break;
      }
      case "--matrix": {
        parsed.matrix = parseMatrix(readValue(args, ++index, arg));
        explicitMatrix = true;
        break;
      }
      case "--concurrency": {
        parsed.concurrency = parseConcurrency(readValue(args, ++index, arg));
        break;
      }
      case "--framework": {
        const frameworkId = readValue(args, ++index, arg);
        frameworkForId(frameworkId);
        parsed.frameworkIds = [frameworkId];
        explicitFramework = true;
        break;
      }
      case "--suite": {
        parsed.suite = parseSuite(readValue(args, ++index, arg));
        explicitSuite = true;
        break;
      }
      case "--image": {
        parsed.image = readValue(args, ++index, arg);
        parsed.runtime = "docker";
        break;
      }
      case "--preset": {
        parsed.preset = readValue(args, ++index, arg);
        explicitPreset = true;
        break;
      }
      case "--runtime": {
        parsed.runtime = parseRuntime(readValue(args, ++index, arg));
        break;
      }
      case "--tarballs-dir": {
        parsed.tarballsDir = readValue(args, ++index, arg);
        break;
      }
      case "--preexisting-app": {
        parsed.preexistingApp = true;
        break;
      }
      case "--remote": {
        parsed.remote = true;
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
        parsed.help = true;
        break;
      }
      default: {
        throw new Error(`unknown argument: ${arg}`);
      }
    }
  }

  if (parsed.runtime === "binary" && parsed.image) {
    throw new Error("--image requires --runtime docker");
  }
  if (parsed.ci) {
    // --ci runs a fixed set of variants (fresh-app matrix, passkey preset,
    // pre-existing app, testkit, remote https) in one process, so the flags
    // that pick a single variant's shape have no meaning alongside it.
    const conflicting = [
      explicitFramework && "--framework",
      explicitSuite && "--suite",
      explicitPreset && "--preset",
      parsed.preexistingApp && "--preexisting-app",
      parsed.remote && "--remote",
    ].filter(Boolean);
    if (conflicting.length > 0) {
      throw new Error(
        `--ci runs the full CI journey set in one process; drop ${conflicting.join(", ")} (the variant set is fixed)`,
      );
    }
    return parsed;
  }
  // --matrix only shapes the fresh-app lane of the --ci set; without --ci it
  // would be silently ignored, so reject it rather than run a different matrix.
  if (explicitMatrix) {
    throw new Error("--matrix only applies with --ci; drop it or add --ci");
  }
  if (parsed.suite === "testkit") {
    if (explicitFramework) {
      throw new Error(
        "--suite testkit runs a fixed next app; drop --framework (the SDK matrix is the frameworks suite's job)",
      );
    }
    if (parsed.preexistingApp) {
      throw new Error(
        "--preexisting-app applies to the frameworks suite only; the testkit suite always scaffolds fresh",
      );
    }
    if (parsed.remote) {
      throw new Error(
        "--remote applies to the frameworks suite only; the testkit suite boots its own instance",
      );
    }
    // The testkit consumer journey scaffolds one next app and runs the
    // @zitadel/testing suite inside it.
    parsed.frameworkIds = ["next"];
  }
  if (parsed.preexistingApp) {
    if (explicitFramework) {
      const unsupported = parsed.frameworkIds.filter(
        (id) => !PREEXISTING_FRAMEWORK_IDS.includes(id),
      );
      if (unsupported.length > 0) {
        throw new Error(
          `--preexisting-app supports ${PREEXISTING_FRAMEWORK_IDS.join(" and ")} only ` +
            `(the widget posture is scoped to route-based frameworks, ADR 044), got ${unsupported.join(", ")}`,
        );
      }
    } else {
      parsed.frameworkIds = [...PREEXISTING_FRAMEWORK_IDS];
    }
  }

  return parsed;
}

function parseSuite(value) {
  if (value === "frameworks" || value === "testkit") {
    return value;
  }
  throw new Error(`--suite must be frameworks or testkit, got ${value}`);
}

function parseMatrix(value) {
  if (value === "single" || value === "full") {
    return value;
  }
  throw new Error(`--matrix must be single or full, got ${value}`);
}

function parseRuntime(value) {
  if (value === "binary" || value === "docker") {
    return value;
  }
  throw new Error(`--runtime must be binary or docker, got ${value}`);
}

function parseConcurrency(value) {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got ${value}`);
  }
  return concurrency;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
