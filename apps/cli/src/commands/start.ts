import { Flags } from "@oclif/core";

import { ZitadelError, toZitadelError } from "../lib/errors";
import { serverLogAction } from "../lib/journey-guidance";
import { ensureLocalAdmin, type LocalAdmin } from "../lib/local-server/admin-credential";
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
import { consoleSignInUrl } from "../lib/local-server/sign-in";
import { BaseCommand, CommandGroups, type JsonEnvelope, nonBlankString } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { nextCommandsData } from "../lib/oclif/envelope";
import { unscopedCommand } from "../lib/suggestion";
import { reportWarning } from "../lib/warnings";

export default class Start extends BaseCommand {
  static override description = "Start a local Zitadel server.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 1;
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
    // The sign-in link is for the structured report only. A person is told to
    // create an app next, and `zitadel console` mints a link whenever they want
    // the console; minting one they are never shown would only spend it or warn
    // about it. The local admin is created either way.
    const consoleLogin = this.jsonEnabled()
      ? await consoleLoginFor(runtime.server_url, local?.admin)
      : undefined;
    const data = readyData(runtime, alreadyRunning, this.meta.cliVersion, consoleLogin);
    return this.emit({
      status: "ok",
      pretty: readyText(data.title, runtime.server_url, this.meta.cliVersion),
      data,
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

/**
 * Mints a console sign-in link for the local admin. A failure (for
 * example a data directory from before the local admin existed) must not fail
 * the start itself, so it degrades to a warning with the fix. Without a local
 * admin there is nothing to sign in as, and the result carries no console.
 */
async function consoleLoginFor(
  serverUrl: string,
  admin: LocalAdmin | undefined,
): Promise<ConsoleLogin | undefined> {
  if (!admin) {
    return undefined;
  }
  try {
    const url = await consoleSignInUrl(serverUrl, admin);
    return { signed_in_as: admin.email, sign_in_url: url };
  } catch (error) {
    const reason = toZitadelError(error);
    reportWarning(`Could not create a console sign-in link: ${reason.message}`);
    return { signed_in_as: admin.email, error: reason.message, hint: reason.hint };
  }
}

/**
 * What a person sees once the server is up: where it is, and that the next
 * step is creating an app. The command is the one `next_commands` carries.
 */
function readyText(title: string, serverUrl: string, cliVersion: string): string {
  return [
    title,
    `Server: ${serverUrl}`,
    "",
    "Next: create an app with authentication.",
    "",
    "Run this command in the same directory. Setup will guide you",
    "through choosing a framework and sign-in method, create your",
    "app, and install its dependencies.",
    "",
    `  ${unscopedCommand("setup --server local", cliVersion)}`,
  ].join("\n");
}

type ConsoleLogin = {
  signed_in_as: string;
  sign_in_url?: string;
  error?: string;
  hint?: string;
};

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
    },
    ...(console ? { console } : {}),
    next_actions: [
      ...(console?.sign_in_url
        ? [`Console: you are ${console.signed_in_as}. Open ${console.sign_in_url} (works once).`]
        : []),
      "Run setup in this directory or one inside it, so it finds this server's local admin; the CLI will detect the framework or ask when needed.",
      "Setup installs dependencies when needed; then start your app dev server.",
      serverLogAction(cliVersion),
    ],
    ...nextCommandsData([
      unscopedCommand("setup --server local", cliVersion),
      // Only when a link could actually be minted: `zitadel console` mints
      // the same way, so suggesting it after a failure sends the caller at a
      // command that fails again.
      ...(console?.sign_in_url ? [unscopedCommand("console", cliVersion)] : []),
    ]),
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
