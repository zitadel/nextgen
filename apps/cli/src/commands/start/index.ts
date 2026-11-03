import { Flags } from "@oclif/core";

import { serverLogAction } from "../../lib/journey-guidance";
import { ensureLocalAdmin } from "../../lib/local-server/admin-credential";
import { EMPTY_SUMMARY, loadProjectEnv } from "../../lib/local-server/env-vars";
import { portFlag } from "../local-server/flags/port";
import { localPort } from "../local-server/requirements/local-port";
import { imageNeedsDockerRule } from "./rules/image-needs-docker";
import {
  PLATFORM_PROJECT_ID,
  defaultLocalServerImageForCliVersion,
  ensureLocalState,
  localContainerName,
  localServerUrl,
  resolveRuntimeBackend,
  type RuntimeMetadata,
} from "../../lib/local-server/runtime";
import { LocalServer } from "../../lib/local-server/server";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "../../lib/oclif";
import type { NextSteps } from "../../lib/oclif/next-steps";
import type { SuggestedCommand } from "../../lib/suggestion";

export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 2;
  static override flags = {
    image: nonBlankString({ description: "Container image to run." }),
    port: portFlag({
      description:
        "Local HTTP port. By default this directory keeps the port it had, or takes the first free one from 8080.",
    }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  static override rules = [imageNeedsDockerRule];

  static override requires = {
    port: localPort,
  };

  protected async execute({ flags, port }: Admitted<typeof Start>): Promise<JsonEnvelope> {
    const requestedPort = flags.port;
    const serverUrl = localServerUrl(port);
    const runtimeBackend = resolveRuntimeBackend({
      image: flags.image,
      runtime: flags.runtime,
      envImage: this.env.ZITADEL_LOCAL_IMAGE,
    });
    this.recordTelemetry({ runtime: runtimeBackend });
    const image =
      flags.image ??
      this.env.ZITADEL_LOCAL_IMAGE ??
      defaultLocalServerImageForCliVersion(this.cliVersion);
    const containerName = localContainerName(this.cwd);
    if (this.dryRun) {
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
        },
        next: { commands: [this.suggestUnscoped("start")] },
      });
    }

    await ensureLocalState(this.cwd);
    // NEXTGEN_* variables from .env.local and .env are read before any runtime
    // is stopped and reach the new runtime through its environment only; see
    // env-vars.ts.
    const env = await loadProjectEnv(this.cwd, this.env);
    // The developer exists on their own server from the first start: the
    // server imports the local admin, and the console signs them in by link.
    // The admin is a user of the platform project, so the two travel together:
    // a caller that opts out of the platform bootstrap (a test harness wanting
    // a bare single-project server) gets neither. The opt-out is read from the
    // same merged environment the server receives — the project's env files
    // over the shell — so a `false` in `.env.local` turns both off rather than
    // being overridden by the user file forcing the bootstrap back on.
    const serverEnv = { ...this.env, ...env.values };
    const local = platformBootstrapEnabled(serverEnv)
      ? await ensureLocalAdmin(this.cwd, serverEnv.NEXTGEN_SCHEMA_BUILTIN_PUBLIC_BASE)
      : undefined;

    const { runtime, alreadyRunning } = await LocalServer.at(this.cwd, {
      cliVersion: this.cliVersion,
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
      // Setup reads the server from the directory start ran in, so a run from
      // elsewhere carries it: `setup --server local` from the shell's directory
      // finds no server and scaffolds into the wrong place.
      data: readyData(runtime, alreadyRunning),
      next: readyNext(this.cliVersion, this.suggestUnscoped("setup --server local")),
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

function readyData(metadata: RuntimeMetadata, alreadyRunning: boolean) {
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
  };
}

function readyNext(
  cliVersion: string,
  setupCommand: SuggestedCommand,
): NextSteps<SuggestedCommand> {
  return {
    actions: [
      "Create an app with authentication. Run setup in this directory or a subdirectory.",
      "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
      serverLogAction(cliVersion),
    ],
    commands: [setupCommand],
  };
}
