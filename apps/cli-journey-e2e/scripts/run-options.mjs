import { frameworkForId, frameworkIds } from "./frameworks.mjs";

export function parseLocalJourneyArgs(args) {
  const parsed = {
    concurrency: 1,
    frameworkIds: [...frameworkIds],
    image: "",
    keep: false,
    runtime: "binary",
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
      case "--concurrency": {
        parsed.concurrency = parseConcurrency(readValue(args, ++index, arg));
        break;
      }
      case "--framework": {
        const frameworkId = readValue(args, ++index, arg);
        frameworkForId(frameworkId);
        parsed.frameworkIds = [frameworkId];
        break;
      }
      case "--image": {
        parsed.image = readValue(args, ++index, arg);
        parsed.runtime = "docker";
        break;
      }
      case "--runtime": {
        parsed.runtime = parseRuntime(readValue(args, ++index, arg));
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

  return parsed;
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
