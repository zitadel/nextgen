import { Flags } from "@oclif/core";

import { ZitadelError } from "../lib/errors";
import { serverLogAction } from "../lib/journey-guidance";
import { ensureLocalAdmin } from "../lib/local-server/admin-credential";
import { EMPTY_SUMMARY, loadProjectEnv } from "../lib/local-server/env-vars";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  PLATFORM_PROJECT_ID,
  defaultLocalServerImageForCliVersion,
  ensureLocalState,
  localContainerName,
  localServerUrl,
  peekRuntimeMetadata,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "../lib/local-server/runtime";
import { LocalServer } from "../lib/local-server/server";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankString } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { nextCommandsData } from "../lib/oclif/envelope";
import { unscopedCommand } from "../lib/suggestion";

export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override group = CommandGroups.gettingStarted;

  static override heading = "Starting the local Zitadel server";
  static override groupOrder = 2;
  static override flags = {
    image: nonBlankString({ description: "Container image to run." }),
    port: Flags.integer({
      description:
        "Local HTTP port. By default this directory keeps the port it had, or takes the first free one from 8080.",
    }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Start);
    const requestedPort = flags.port;
    // Where the server will be, as far as is known before one is chosen: the
    // port asked for, else the one this directory already has.
    const recorded = await peekRuntimeMetadata(
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
    const port = requestedPort ?? recorded?.port ?? DEFAULT_LOCAL_SERVER_PORT;
    const serverUrl = localServerUrl(port);
    await this.toMeta(flags, { resolveServer: false, source: serverUrl });

    validatePort(port);
    const runtimeBackend = resolveRuntimeBackend({
      image: flags.image,
      runtime: flags.runtime,
      envImage: this.meta.env.ZITADEL_LOCAL_IMAGE,
    });
    assertRuntimeFlags(runtimeBackend, flags.image);
    this.recordTelemetry({ runtime: runtimeBackend });
    const image =
      flags.image ??
      this.meta.env.ZITADEL_LOCAL_IMAGE ??
      defaultLocalServerImageForCliVersion(this.meta.cliVersion);
    const containerName = localContainerName(this.meta.cwd);
    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: "Local Zitadel server start plan.",
          runtime: {
            backend: runtimeBackend,
            ...(runtimeBackend === "docker"
              ? {
                  container_name: containerName,
                  image,
                }
              : {}),
            port,
          },
          urls: {
            api: serverUrl,
            console: `${serverUrl}/ui/console/`,
          },
          ...nextCommandsData([unscopedCommand("start", this.meta.cliVersion)]),
        },
      });
    }

    await ensureLocalState(this.meta.cwd);
    // NEXTGEN_* variables from .env.local and .env are read before any runtime
    // is stopped and reach the new runtime through its environment only; see
    // env-vars.ts.
    const env = await loadProjectEnv(this.meta.cwd, this.meta.env);
    // The developer exists on their own server from the first start: the
    // server imports the local admin, and the console signs them in by link.
    // The admin is a user of the platform project, so the two travel together:
    // a caller that opts out of the platform bootstrap (a test harness wanting
    // a bare single-project server) gets neither. The opt-out is read from the
    // same merged environment the server receives — the project's env files
    // over the shell — so a `false` in `.env.local` turns both off rather than
    // being overridden by the user file forcing the bootstrap back on.
    const serverEnv = { ...this.meta.env, ...env.values };
    const local = platformBootstrapEnabled(serverEnv)
      ? await ensureLocalAdmin(this.meta.cwd, serverEnv.NEXTGEN_SCHEMA_BUILTIN_PUBLIC_BASE)
      : undefined;

    const { runtime, alreadyRunning } = await LocalServer.at(this.meta.cwd, {
      cliVersion: this.meta.cliVersion,
    }).start(
      runtimeBackend === "docker"
        ? { backend: "docker", image, env, userFile: local?.userFile }
        : { backend: "binary", env, userFile: local?.userFile },
      { port: requestedPort },
    );
    // The envelope's `source` named the port guessed before one was chosen; an
    // agent that follows it would target a different server than the one started.
    this.meta = { ...this.meta, source: runtime.server_url };
    return this.emit({
      status: "ok",
      data: readyData(runtime, alreadyRunning, this.meta.cliVersion),
    });
  }
}

/**
 * Whether this start boots the platform project, and with it the local admin.
 * On by default; an explicit `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=false` opts
 * out, which is how a harness asks for a bare single-project instance.
 */
function platformBootstrapEnabled(env: NodeJS.ProcessEnv): boolean {
  if ((env.NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT ?? "true").toLowerCase() === "false") {
    return false;
  }
  // A server pinned to a project of its own cannot also bootstrap the platform
  // one — it refuses that combination at startup (cmd/server/config.go) — so the
  // pin wins and there is no local admin, rather than a start that cannot boot.
  const pinned = env.NEXTGEN_PLATFORM_PROJECT_ID;
  return !pinned || pinned === PLATFORM_PROJECT_ID;
}

function readyData(metadata: RuntimeMetadata, alreadyRunning: boolean, cliVersion: string) {
  return {
    title: alreadyRunning
      ? "Local Zitadel server is already running."
      : "Local Zitadel server is ready.",
    runtime: {
      backend: metadata.backend,
      ...(metadata.backend === "docker"
        ? {
            container_name: metadata.container_name,
            container_id: metadata.container_id,
            image: metadata.image,
          }
        : {
            pid: metadata.pid,
            log_path: metadata.log_path,
            server_package: metadata.server_package,
            server_version: metadata.server_version,
          }),
      port: metadata.port,
      data_dir: metadata.data_dir,
      env: metadata.env ?? EMPTY_SUMMARY,
    },
    urls: {
      api: metadata.server_url,
      console: `${metadata.server_url}/ui/console/`,
    },
    next_actions: [
      "Create an app with authentication by running setup in this directory or a subdirectory.",
      "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
      serverLogAction(cliVersion),
    ],
    ...nextCommandsData([unscopedCommand("setup --server local", cliVersion)]),
  };
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ZitadelError("E_VALIDATION", `Invalid port ${String(port)}`, {
      hint: "Use a TCP port between 1 and 65535.",
    });
  }
}

function resolveRuntimeBackend(input: {
  runtime: unknown;
  image: string | undefined;
  envImage: string | undefined;
}): RuntimeBackend {
  if (input.runtime === "binary" || input.runtime === "docker") {
    return input.runtime;
  }
  if (input.image || input.envImage) {
    return "docker";
  }
  return "binary";
}

function assertRuntimeFlags(runtime: RuntimeBackend, image: string | undefined): void {
  if (runtime === "binary" && image) {
    throw new ZitadelError("E_VALIDATION", "--image requires --runtime docker", {
      hint: "Use `zitadel start --runtime docker --image <tag>`, or omit --image for the npm binary runtime.",
    });
  }
}
