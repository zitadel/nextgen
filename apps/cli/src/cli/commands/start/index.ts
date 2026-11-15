import { Flags } from "@oclif/core";
import { z } from "zod";

import { startedServer } from "@/cli/commands/local-server/started";
import { serverLogAction } from "@/lib/journey-guidance";
import { ensureLocalAdmin } from "@/lib/local-server/admin-credential";
import { EMPTY_SUMMARY, loadProjectEnv } from "@/lib/local-server/env-vars";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  defaultLocalServerImageForCliVersion,
  ensureLocalState,
  localContainerName,
  localServerUrl,
  PLATFORM_PROJECT_ID,
  peekRuntimeMetadata,
  RUNTIME_BACKENDS,
  type RuntimeMetadata,
  resolveRuntimeBackend,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { type Refused, reads, whole } from "@/lib/oclif/flags";
import type { NextSteps } from "@/lib/oclif/next-steps";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import type { Suggest, SuggestedCommand } from "@/lib/suggestion";
import { type Fact, section } from "@/lib/ui";

/**
 * How an image beside the binary runtime is refused: an image is a container's,
 * and the npm binary runtime has none to run.
 */
const IMAGE_NEEDS_DOCKER_REFUSAL = {
  message: "--image requires --runtime docker",
  hint: "Pass --runtime docker with --image <tag>, or omit --image for the npm binary runtime.",
} as const satisfies Refusal;

const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * A TCP port, refusing what is not a whole number from 1 to 65535, which is no
 * port a server can listen on.
 */
const PORT = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
} as const satisfies Refused<number>;

/**
 * `zitadel start` — start a local Zitadel server.
 */
export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 2;

  static override flags = {
    image: nonBlankString({ description: "Container image to run." }),
    port: Flags.custom<number>({
      parse: reads(PORT),
    })({
      description:
        "Local HTTP port. By default this directory keeps the port it had, or takes the first free one from 8080.",
    }),
    runtime: Flags.option({
      description: "Local runtime backend.",
      options: RUNTIME_BACKENDS,
    })(),
  };

  static override meta = {
    resolveServer: false,
  };

  private readonly recorded = startedServer(peekRuntimeMetadata);

  protected override async sourceOf(flags: Record<string, unknown>, cwd: string): Promise<string> {
    return localServerUrl(await this.portOf(flags, cwd));
  }

  protected async execute({ flags }: Admitted<typeof Start>): Promise<JsonEnvelope> {
    if (flags.runtime === "binary" && flags.image !== undefined) {
      throw refusalError(IMAGE_NEEDS_DOCKER_REFUSAL, {});
    }
    const port = await this.portOf(flags);
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
    if (this.dryRun) {
      const title = "Would start the local Zitadel server (dry run)";
      const imaged: Fact[] = runtimeBackend === "docker" ? [["Image", image]] : [];

      return this.emit({
        status: "ok",
        data: {
          dry_run: true,
          title,
          runtime: {
            backend: runtimeBackend,
            ...(runtimeBackend === "docker"
              ? {
                  container_name: localContainerName(this.cwd),
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
        summary: {
          title,
          sections: [
            section(
              undefined,
              ["Runtime", runtimeBackend],
              ...imaged,
              ["Port", String(port)],
              ["API", serverUrl],
              ["Console", `${serverUrl}/ui/console/`],
            ),
          ],
        },
        next: {
          commands: [await this.realRun()],
        },
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
    const serverEnv = {
      ...this.env,
      ...env.values,
    };
    const local = platformBootstrapEnabled(serverEnv)
      ? await ensureLocalAdmin(this.cwd, serverEnv.NEXTGEN_SCHEMA_BUILTIN_PUBLIC_BASE)
      : undefined;

    const { runtime, alreadyRunning } = await LocalServer.at(this.cwd, {
      cliVersion: this.cliVersion,
    }).start(
      runtimeBackend === "docker"
        ? {
            backend: "docker",
            image,
            env,
            userFile: local?.userFile,
          }
        : {
            backend: "binary",
            env,
            userFile: local?.userFile,
          },
      { port: flags.port, retry: await this.again("start", {}) },
    );
    // The envelope's `source` named the port guessed before one was chosen; an
    // agent that follows it would target a different server than the one started.
    this.meta = {
      ...this.meta,
      source: runtime.server_url,
    };

    // Setup reads the server from the directory start ran in, so a run from
    // elsewhere carries it: `setup --server local` from the shell's directory
    // finds no server and scaffolds into the wrong place.
    return this.emit({
      status: "ok",
      data: readyData(runtime, alreadyRunning),
      summary: {
        title: alreadyRunning
          ? "Local Zitadel server is already running"
          : "Local Zitadel server is ready",
        sections: [
          section(
            undefined,
            runtime.backend === "binary"
              ? ["Process", String(runtime.pid)]
              : ["Container", runtime.container_name],
            ["API", runtime.server_url],
            ["Console", `${runtime.server_url}/ui/console/`],
            ["Data", runtime.data_dir],
          ),
        ],
      },
      next: readyNext(this.suggest),
    });
  }

  /**
   * Where the server will be, as far as is known before one is chosen: the
   * port asked for, else the one this directory already has.
   */
  private async portOf(flags: Record<string, unknown>, cwd = this.cwd): Promise<number> {
    const asked = typeof flags.port === "number" ? flags.port : undefined;
    // A record whose port is no port is no record: `readRuntimeMetadata`
    // drops it, so the default stands and nothing here reads it again.
    return asked ?? (await this.recorded.of(cwd))?.port ?? DEFAULT_LOCAL_SERVER_PORT;
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
      ? "Local Zitadel server is already running"
      : "Local Zitadel server is ready",
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

function readyNext(suggest: Suggest): NextSteps<SuggestedCommand> {
  return {
    actions: [
      "Create an app with authentication. Run setup in this directory or a subdirectory.",
      "Setup asks for a framework and sign-in method, creates or updates your app, and installs its dependencies.",
      serverLogAction(suggest),
    ],
    commands: [suggest({ id: "setup", flags: { server: "local" } })],
  };
}
