import { Flags } from "@oclif/core";
import consola from "consola";

import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { dockerAvailable, imageAvailable } from "../../lib/local-server/docker";
import {
  DEFAULT_LOCAL_SERVER_IMAGE,
  DEFAULT_LOCAL_SERVER_PORT,
  assertWritableDirectory,
  checkLocalServerHealth,
  isPortAvailable,
  localRuntimePaths,
  localServerUrl,
  readRuntimeMetadata,
} from "../../lib/local-server/runtime";
import { createOrca } from "../../lib/orca";
import { hasZitadelConfig } from "../../lib/project";
import { SANITY_CHECKS, type CheckContext, type CheckOutcome } from "./checks";

const LOCAL_RUNTIME_CHECK_NAMES = new Set(["docker-cli", "image", "state-dir", "port", "runtime"]);

/**
 * `zitadel doctor` — verify generated files and local state.
 *
 * Runs every registered {@link SANITY_CHECKS} entry and emits the aggregate
 * result; if any check fails it throws `E_VALIDATION` carrying the full check
 * details. With `--fix`, each failing check first attempts its own repair (a
 * no-op for checks with no safe automatic remedy), then the battery re-runs.
 *
 * The `--fix` loop is best-effort: a repair that throws (e.g. a missing
 * prerequisite file the check itself would also flag) is logged at debug
 * level and skipped, not propagated — the post-fix re-verify still reports
 * whatever remains broken.
 */
export default class Doctor extends BaseCommand {
  static override description = "Verify local runtime and project state.";
  static override flags = {
    fix: Flags.boolean({ description: "Re-apply missing managed files." }),
    image: Flags.string({ description: "Container image to check." }),
    port: Flags.integer({ description: "Local HTTP port.", default: DEFAULT_LOCAL_SERVER_PORT }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Doctor);
    const port = flags.port ?? DEFAULT_LOCAL_SERVER_PORT;
    await this.toMeta(flags, { resolveServer: false, source: localServerUrl(port) });
    const { cwd, dryRun } = this.meta;
    const image = flags.image ?? this.meta.env.ZITADEL_LOCAL_IMAGE ?? DEFAULT_LOCAL_SERVER_IMAGE;
    const runtimeChecks = await runLocalRuntimeChecks(cwd, image, port);
    const hasConfig = await hasZitadelConfig(cwd);
    const ctx: CheckContext = { cwd, orca: createOrca(), cliVersion: this.meta.cliVersion, dryRun };

    if (hasConfig && flags.fix) {
      const before = await Promise.all(SANITY_CHECKS.map((check) => check.run(ctx)));
      for (const [index, check] of SANITY_CHECKS.entries()) {
        if (before[index]?.status !== "fail") {
          continue;
        }
        try {
          await check.fix(ctx);
        } catch (error) {
          consola.debug(`doctor --fix: ${check.name} repair failed`, error);
        }
      }
    }

    const projectChecks = hasConfig
      ? await Promise.all(SANITY_CHECKS.map((check) => check.run(ctx)))
      : [];
    const checks = [...runtimeChecks, ...projectChecks];
    const failed = checks.filter((check) => check.status === "fail");
    const data = {
      title: failed.length === 0 ? "Zitadel doctor passed." : "Zitadel doctor found issues.",
      ok: failed.length === 0,
      image,
      port,
      project: {
        lifecycle: hasConfig ? "configured" : "not-configured",
      },
      checks,
    };

    if (failed.length > 0) {
      const advice = failureAdvice(failed, image, port);
      throw new ZitadelError("E_VALIDATION", "Zitadel doctor found issues", {
        hint: advice.hint,
        nextCommands: advice.nextCommands,
        details: data,
      });
    }

    return this.emit({ status: "ok", data });
  }
}

function failureAdvice(
  failed: CheckOutcome[],
  image: string,
  port: number,
): { hint: string; nextCommands: string[] } {
  const failedNames = new Set(failed.map((check) => check.name));

  if (failedNames.has("docker-cli")) {
    return {
      hint:
        "Docker is required for `zitadel start`, but the Docker daemon is not reachable. Install or start Docker, then rerun `zitadel doctor`.",
      nextCommands: ["docker version", "zitadel doctor"],
    };
  }

  if (failedNames.has("image")) {
    return {
      hint:
        "The local Zitadel image is not available. Check Docker registry access, build it locally, or pass --image / ZITADEL_LOCAL_IMAGE.",
      nextCommands: [`docker pull ${image}`, "zitadel doctor"],
    };
  }

  if (failedNames.has("state-dir")) {
    return {
      hint: "The local Zitadel state directory is not writable. Fix directory permissions, then rerun `zitadel doctor`.",
      nextCommands: ["zitadel doctor"],
    };
  }

  if (failedNames.has("port")) {
    const fallbackPort = port === DEFAULT_LOCAL_SERVER_PORT ? port + 1 : DEFAULT_LOCAL_SERVER_PORT;
    return {
      hint: `Port ${String(port)} is already in use. Stop the process using it, or choose another port for local Zitadel.`,
      nextCommands: [`zitadel doctor --port ${String(fallbackPort)}`],
    };
  }

  if (failedNames.has("runtime")) {
    return {
      hint:
        "Existing local runtime metadata was found, but the local Zitadel server is not healthy. Start it again or reset stale local data.",
      nextCommands: ["zitadel start", "zitadel reset --force"],
    };
  }

  const hasProjectFailure = failed.some((check) => !LOCAL_RUNTIME_CHECK_NAMES.has(check.name));
  if (hasProjectFailure) {
    return {
      hint: "Run `npx @zitadel/cli@alpha doctor --fix` to re-apply missing managed files.",
      nextCommands: ["zitadel doctor --fix"],
    };
  }

  return {
    hint: "Fix the reported checks, then rerun `zitadel doctor`.",
    nextCommands: ["zitadel doctor"],
  };
}

async function runLocalRuntimeChecks(
  cwd: string,
  image: string,
  port: number,
): Promise<CheckOutcome[]> {
  const runtime = await readRuntimeMetadata(cwd);
  return [
    await check("docker-cli", "Docker is reachable", async () => {
      const result = await dockerAvailable();
      if (result.status !== 0) {
        throw new Error(result.stderr || "docker version failed");
      }
      return `Docker engine ${result.stdout.trim() || "available"}`;
    }),
    await check("image", `Image ${image} is available`, async () => {
      const source = await imageAvailable(image);
      return source === "local"
        ? `Image ${image} is available locally`
        : `Image ${image} is available from the registry`;
    }),
    await check("state-dir", "Local state directory is writable", async () => {
      const paths = localRuntimePaths(cwd);
      await assertWritableDirectory(paths.dataDir);
      return `${paths.dataDir} is writable`;
    }),
    await check("port", `Port ${String(port)} is available`, async () => {
      if (runtime && (await checkLocalServerHealth(runtime.server_url))) {
        return `${runtime.server_url} is already healthy`;
      }
      if (!(await isPortAvailable(port))) {
        throw new Error(`Port ${String(port)} is already in use`);
      }
      return `Port ${String(port)} is available`;
    }),
    await check("runtime", "Existing local runtime is healthy", async () => {
      if (!runtime) {
        return "No existing runtime metadata";
      }
      if (!(await checkLocalServerHealth(runtime.server_url))) {
        throw new Error(`${runtime.server_url} did not respond to /healthz`);
      }
      return `${runtime.server_url} is healthy`;
    }),
  ];
}

async function check(
  name: string,
  fallback: string,
  run: () => Promise<string>,
): Promise<CheckOutcome> {
  try {
    return { name, status: "pass", message: await run() };
  } catch (error) {
    return {
      name,
      status: "fail",
      message: error instanceof Error ? error.message : fallback,
    };
  }
}
