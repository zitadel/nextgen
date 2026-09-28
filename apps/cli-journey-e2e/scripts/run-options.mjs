import { frameworkForId, frameworkIds } from "./frameworks.mjs";

// The pre-existing-app lane covers the widget posture (ADR 044), which is
// scoped to the route-based frameworks: only their patchers leave the host
// app a shell for the widget to embed into. Mirrors ROUTE_BASED_FRAMEWORKS
// in apps/cli/src/lib/orca/patchers/posture.ts.
const PREEXISTING_FRAMEWORK_IDS = ["next", "nuxt"];

export function parseLocalJourneyArgs(args) {
  const parsed = {
    concurrency: 5,
    frameworkIds: [...frameworkIds],
    image: "",
    keep: false,
    preexistingApp: false,
    preset: "",
    runtime: "binary",
    suite: "frameworks",
    tarballsDir: "",
    workDir: "",
  };
  let explicitFramework = false;

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
        break;
      }
      case "--image": {
        parsed.image = readValue(args, ++index, arg);
        parsed.runtime = "docker";
        break;
      }
      case "--preset": {
        parsed.preset = readValue(args, ++index, arg);
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
