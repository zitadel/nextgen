import { Flags } from "@oclif/core";

import { EMPTY_SUMMARY } from "../lib/local-server/env-vars";
import {
  assertRuntimeFlags,
  launchLocalServer,
  resolveRuntimeBackend,
  validatePort,
  type ConsoleLogin,
} from "../lib/local-server/launch";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  defaultLocalServerImageForCliVersion,
  localContainerName,
  localServerUrl,
  type RuntimeMetadata,
} from "../lib/local-server/runtime";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { publicCliCommand } from "../lib/public-cli";

export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 1;
  static override flags = {
    image: Flags.string({ description: "Container image to run." }),
    port: Flags.integer({ description: "Local HTTP port.", default: DEFAULT_LOCAL_SERVER_PORT }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Start);
    const port = flags.port ?? DEFAULT_LOCAL_SERVER_PORT;
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
            login: `${serverUrl}/ui/login/`,
          },
          next_commands: [publicCliCommand("start", this.meta.cliVersion)],
        },
      });
    }

    const launch = await launchLocalServer({
      cwd: this.meta.cwd,
      env: this.meta.env,
      cliVersion: this.meta.cliVersion,
      backend: runtimeBackend,
      containerName,
      image,
      port,
      serverUrl,
    });
    return this.emit({
      status: "ok",
      data: readyData(
        launch.metadata,
        launch.alreadyRunning,
        this.meta.cliVersion,
        launch.console,
      ),
    });
  }
}

function readyData(
  metadata: RuntimeMetadata,
  alreadyRunning: boolean,
  cliVersion: string,
  console: ConsoleLogin | undefined,
) {
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
      login: `${metadata.server_url}/ui/login/`,
    },
    ...(console ? { console } : {}),
    next_actions: [
      ...(console?.sign_in_url
        ? [`Console: you are ${console.signed_in_as}. Open ${console.sign_in_url} (works once).`]
        : []),
      "From your app directory, run setup; the CLI will detect the framework or ask when needed.",
      "Setup installs dependencies when needed; then start your app dev server.",
    ],
    next_commands: [
      publicCliCommand("setup --server local", cliVersion),
      // Only when a link could actually be minted: `zitadel console` mints
      // the same way, so suggesting it after a failure sends the caller at a
      // command that fails again.
      ...(console?.sign_in_url ? [publicCliCommand("console", cliVersion)] : []),
    ],
  };
}
