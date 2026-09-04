import { createZitadelClient } from "@zitadel/api/client";

import {
  claimAction,
  claimCommand,
  claimState,
  claimWindowClosedAction,
  type ClaimState,
} from "../lib/claim-state";
import { isProcessRunning } from "../lib/local-server/binary";
import { inspectContainer } from "../lib/local-server/docker";
import { customizeAndPublishActions, verifyLoginAction } from "../lib/journey-guidance";
import {
  DEFAULT_LOCAL_SERVER_URL,
  checkLocalServerHealth,
  readRuntimeMetadata,
  runtimeSummary,
} from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import {
  hasZitadelConfig,
  hasZitadelSecret,
  readDevelopmentIssuer,
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
} from "../lib/project";
import { publicCliCommand } from "../lib/public-cli";

/**
 * `zitadel status` — summarize the local server and project state.
 *
 * This is intentionally informational: a missing `zitadel.json`, stopped
 * local server, or orphaned config should be visible without making `status`
 * itself fail.
 */
export default class Status extends BaseCommand {
  static override description = "Summarize the local Zitadel server and project state.";

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Status);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const runtime = await readRuntimeMetadata(cwd);
    if (flags.server === "local") {
      await this.toMeta(flags, {
        resolveServer: false,
        source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
      });
    } else {
      await this.toMeta(flags);
    }
    let docker: Awaited<ReturnType<typeof inspectContainer>> | undefined;
    let dockerError: string | undefined;
    if (runtime?.backend === "docker") {
      try {
        docker = await inspectContainer(runtime.container_name);
      } catch (error) {
        dockerError = error instanceof Error ? error.message : String(error);
      }
    }
    const healthy = runtime ? await checkLocalServerHealth(runtime.server_url) : false;
    const processRunning = runtime?.backend === "binary" ? isProcessRunning(runtime.pid) : false;
    const serverLifecycle = lifecycleForRuntime({ docker, healthy, processRunning, runtime });

    const project = await projectStatus(this.meta.cwd);
    const users =
      project.lifecycle === "configured"
        ? await detectUserPresence(this.meta.cwd, this.meta.source)
        : "unknown";
    const nextCommands = nextCommandsFor(serverLifecycle, project, users, this.meta.cliVersion);
    const nextActions = nextActionsFor(project, users, this.meta.cliVersion);

    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel status.",
        server: {
          lifecycle: serverLifecycle,
          runtime: runtimeSummary(runtime),
          docker: {
            available: dockerError === undefined,
            error: dockerError,
            container_exists: docker?.exists ?? false,
            container_running: docker?.running ?? false,
          },
          process:
            runtime?.backend === "binary"
              ? {
                  pid: runtime.pid,
                  running: processRunning,
                }
              : undefined,
          health: {
            healthy,
            url: runtime?.server_url,
          },
        },
        project,
        next_actions: nextActions,
        next_commands: nextCommands,
      },
    });
  }
}

function lifecycleForRuntime(input: {
  docker: Awaited<ReturnType<typeof inspectContainer>> | undefined;
  healthy: boolean;
  processRunning: boolean;
  runtime: Awaited<ReturnType<typeof readRuntimeMetadata>>;
}): string {
  if (!input.runtime) {
    return "missing";
  }
  if (input.runtime.backend === "binary") {
    if (input.processRunning && input.healthy) {
      return "running";
    }
    return input.processRunning ? "unhealthy" : "stopped";
  }
  if (input.docker?.running && input.healthy) {
    return "running";
  }
  if (input.docker?.exists) {
    return "unhealthy";
  }
  return "stopped";
}

type ProjectStatus =
  | {
      lifecycle: "not-configured";
      message: string;
    }
  | {
      lifecycle: "orphaned-config";
      project_id?: string;
      message: string;
    }
  | {
      lifecycle: "configured";
      project_id: string;
      issuer?: string;
      /**
       * Whether the project is attached to a team, from the local
       * `.zitadel/secret`. Omitted entirely off the cloud, where there is
       * nothing to attach and the field would only invite agents to act on it.
       */
      claim?: ClaimState;
    };

async function projectStatus(cwd: string): Promise<ProjectStatus> {
  if (!(await hasZitadelConfig(cwd))) {
    return {
      lifecycle: "not-configured",
      message: "zitadel.json has not been created yet.",
    };
  }

  const config = await readZitadelConfig(cwd);
  if (!(await hasZitadelSecret(cwd))) {
    return {
      lifecycle: "orphaned-config",
      project_id: typeof config.project === "string" ? config.project : undefined,
      message: "zitadel.json exists but .zitadel/secret is missing.",
    };
  }

  const secret = await readZitadelSecret(cwd);
  // Gated on the server recorded in `zitadel.json`, not `this.meta.source`:
  // `status --server local` rewrites the source for the health probe, but it
  // does not move the project, so the source would answer the wrong question.
  const claim = claimState({ secret, server: readProjectServer(config) });
  return {
    lifecycle: "configured",
    project_id: String(config.project ?? secret.project_id ?? ""),
    issuer: readDevelopmentIssuer(config),
    ...(claim.kind === "not-applicable" ? {} : { claim }),
  };
}

type UserPresence = "none" | "some" | "unknown";

const PRESENCE_PROBE_TIMEOUT_MS = 1500;

/**
 * Whether the project has any users yet — the journey signal that stages the
 * guidance: before the first successful registration the next step is
 * verifying login, afterwards it is customizing and publishing config. Best
 * effort by design: any failure (server unreachable, stale secret, timeout)
 * reads as `unknown` and the caller keeps the lifecycle-only output.
 */
async function detectUserPresence(cwd: string, source: string): Promise<UserPresence> {
  try {
    const secret = await readZitadelSecret(cwd);
    const client = createZitadelClient({
      baseUrl: source,
      token: secret.project_secret,
    });
    const probe = client
      .queryUsers({ limit: 1 }, { signal: AbortSignal.timeout(PRESENCE_PROBE_TIMEOUT_MS) })
      .then(({ users }): UserPresence => (users.length > 0 ? "some" : "none"))
      .catch((): UserPresence => "unknown");
    // The abort signal alone is not enough: DNS resolution can outlive it
    // (getaddrinfo runs on the threadpool and some environments take many
    // seconds to fail), and `status` must stay snappy. Race a detached timer
    // so the answer degrades to "unknown" at the deadline no matter what the
    // socket layer does; unref'd so it never keeps the CLI process alive.
    return await Promise.race([
      probe,
      new Promise<UserPresence>((resolve) => {
        setTimeout(() => resolve("unknown"), PRESENCE_PROBE_TIMEOUT_MS + 250).unref();
      }),
    ]);
  } catch {
    return "unknown";
  }
}

function nextActionsFor(project: ProjectStatus, users: UserPresence, cliVersion: string): string[] {
  if (project.lifecycle === "not-configured") {
    return [
      "From your app directory, run setup; the CLI will detect the framework or ask in an empty directory.",
    ];
  }
  if (project.lifecycle !== "configured") {
    return [];
  }
  // Additive to the journey staging rather than a stage of its own: attaching a
  // team is orthogonal to whether login works yet, so it appends to whichever
  // stage the user is in instead of displacing it. A closed window flips the
  // nudge to the no-retry wording: advertising `claim` there would suggest a
  // command the server is guaranteed to refuse.
  const claim =
    project.claim?.kind === "detached"
      ? project.claim.claimable
        ? [
            claimAction(
              cliVersion,
              project.claim.deadline === undefined ? undefined : new Date(project.claim.deadline),
            ),
          ]
        : [claimWindowClosedAction(cliVersion)]
      : [];
  if (users === "none") {
    return [verifyLoginAction(project.issuer), ...claim];
  }
  if (users === "some") {
    return [...customizeAndPublishActions(cliVersion), ...claim];
  }
  return claim;
}

function nextCommandsFor(
  serverLifecycle: string,
  project: ProjectStatus,
  users: UserPresence,
  cliVersion: string,
): string[] {
  const commands: string[] = [];
  if (serverLifecycle !== "running") {
    commands.push(publicCliCommand("start", cliVersion));
  }
  if (project.lifecycle === "not-configured") {
    commands.push(publicCliCommand("setup --server local", cliVersion));
  } else if (project.lifecycle === "orphaned-config") {
    commands.push(
      publicCliCommand("setup --force", cliVersion),
      publicCliCommand("doctor --fix", cliVersion),
    );
  } else {
    commands.push(publicCliCommand("doctor", cliVersion));
    // Suggested even when the local record says the window has closed: the
    // record can be stale (claimed from another machine reads detached), and
    // `claim` is the safe reconciliation — the server checks the grant
    // before the window, so an attached project answers with a clean skip.
    if (project.claim?.kind === "detached") {
      commands.push(claimCommand(cliVersion));
    }
    if (users === "none") {
      // Staged like next_actions: before the first login is proven in a
      // browser, publishing is premature — `plan` previews safely and the
      // verify mission lives in next_actions. `apply` joins once users
      // exist ("some") or when the probe can't tell ("unknown" keeps the
      // lifecycle-only behavior rather than withholding on no signal).
      commands.push(publicCliCommand("plan", cliVersion));
    } else {
      commands.push(publicCliCommand("apply", cliVersion));
    }
  }
  return commands;
}
