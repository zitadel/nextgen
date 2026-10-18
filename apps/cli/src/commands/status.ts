import {
  claimAction,
  claimCommand,
  claimState,
  claimWindowClosedAction,
  type ClaimState,
} from "../lib/claim-state";
import { customizeAndPublishActions, verifyLoginAction } from "../lib/journey-guidance";
import {
  DEFAULT_LOCAL_SERVER_URL,
  readRuntimeMetadata,
  runtimeSummary,
} from "../lib/local-server/runtime";
import { LocalServer } from "../lib/local-server/server";
import {
  type Connection,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
} from "../lib/oclif";
import { resolveCwd } from "../lib/paths";
import { shellArg } from "../lib/shell";
import {
  hasZitadelConfig,
  hasZitadelSecret,
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
} from "../lib/project";
import {
  type EnvironmentSelector,
  projectCommand,
  type SuggestedCommand,
  unscopedCommand,
} from "../lib/suggestion";
import { nextCommandsData } from "../lib/oclif/envelope";

/**
 * `zitadel status` — summarize the local server and project state.
 *
 * This is intentionally informational: a missing `zitadel.json`, stopped
 * local server, or orphaned config should be visible without making `status`
 * itself fail.
 */
export default class Status extends EnvironmentCommand {
  static override description = "Summarize the local Zitadel server and project state.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 3;

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
    const server = await LocalServer.at(this.meta.cwd, {
      cliVersion: this.meta.cliVersion,
    }).status();
    const serverLifecycle = server.lifecycle;

    const project = await projectStatus(
      this.meta.cwd,
      this.environment.values.ZITADEL_ISSUER?.value,
      this.environment.values.ZITADEL_PROJECT_ID?.value,
      this.environment.envFile !== undefined || this.environment.name.value !== "development"
        ? { name: this.environment.name.value, envFile: this.environment.envFile }
        : undefined,
    );
    const users =
      project.lifecycle === "configured"
        ? await detectUserPresence(() => this.connect({ quiet: true, prompt: false }))
        : "unknown";
    const nextCommands = nextCommandsFor(
      serverLifecycle,
      project,
      users,
      this.meta.cliVersion,
      this.environmentSelector(),
      // `--cwd` as typed, for the follow-ups the selector does not carry: the
      // runtime and the project files they act on live in that directory.
      typeof flags.cwd === "string" ? ` --cwd ${shellArg(flags.cwd)}` : "",
    );
    const nextActions = nextActionsFor(
      project,
      users,
      this.meta.cliVersion,
      this.environmentSelector(),
    );

    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel status.",
        server: {
          lifecycle: serverLifecycle,
          runtime: runtimeSummary(server.runtime),
          docker: server.docker,
          process: server.process,
          health: {
            healthy: server.healthy,
            url: server.runtime?.server_url,
          },
        },
        project,
        next_actions: nextActions,
        ...nextCommandsData(nextCommands),
      },
    });
  }
}

type ProjectStatus =
  | {
      lifecycle: "not-configured";
      message: string;
      /**
       * The environment that names no project, when it is not the default
       * development one: `setup` would not bind it, `env add` does.
       */
      environment?: string;
      /** The `--env-file` that names no project. */
      env_file?: string;
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

/**
 * `resolvedProjectId` is the project the environment resolved to — the same one
 * {@link detectUserPresence} probes through `connect()`. The displayed project
 * must be that one, not the id in `zitadel.json`, or `status --env` would name
 * one project while reporting another's users.
 */
async function projectStatus(
  cwd: string,
  issuer: string | undefined,
  resolvedProjectId: string | undefined,
  // Set when the run named an environment other than the default development
  // one, or a file: its project is whatever it resolves, never setup's.
  named: { name: string; envFile?: string } | undefined,
): Promise<ProjectStatus> {
  if (!(await hasZitadelConfig(cwd))) {
    return {
      lifecycle: "not-configured",
      message: "zitadel.json has not been created yet.",
    };
  }
  // The local `zitadel.json` and `.zitadel/secret` describe the development
  // project. Reported under another environment's name, they would send every
  // suggested `--env` follow-up at a project that environment never binds.
  if (resolvedProjectId === undefined && named !== undefined) {
    return named.envFile === undefined
      ? {
          lifecycle: "not-configured",
          environment: named.name,
          message: `The ${named.name} environment names no project.`,
        }
      : {
          lifecycle: "not-configured",
          env_file: named.envFile,
          message: `${named.envFile} sets no ZITADEL_PROJECT_ID.`,
        };
  }

  const config = await readZitadelConfig(cwd);
  const secret = (await hasZitadelSecret(cwd)) ? await readZitadelSecret(cwd) : undefined;
  // The resolved environment decides the project when it names one — a
  // `status --env production` reads the project from `.env.production.local`,
  // which the local `.zitadel/secret` need not back. Only a config that
  // resolves to no project at all, with no local secret to fall back on, is
  // genuinely orphaned; derive the project first so the env wins over that
  // fallback.
  if (secret === undefined && resolvedProjectId === undefined) {
    return {
      lifecycle: "orphaned-config",
      project_id: typeof config.project === "string" ? config.project : undefined,
      message: "zitadel.json exists but .zitadel/secret is missing.",
    };
  }

  const projectId = resolvedProjectId ?? String(config.project ?? secret?.project_id ?? "");
  // The claim record lives in `.zitadel/secret`, which belongs to the local
  // project. It describes `projectId` only when the resolved environment points
  // at that same project; a `--env` aimed at another project has no local claim
  // record to show, so the block is omitted rather than shown against the wrong
  // project. Gated on the server in `zitadel.json`, not `this.meta.source`:
  // `status --server local` rewrites the source for the health probe but does
  // not move the project, so the source would answer the wrong question.
  const claim =
    secret !== undefined && projectId === secret.project_id
      ? claimState({ secret, server: readProjectServer(config) })
      : ({ kind: "not-applicable" } as const);
  return {
    lifecycle: "configured",
    project_id: projectId,
    issuer,
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
async function detectUserPresence(connect: () => Promise<Connection>): Promise<UserPresence> {
  try {
    const { client } = await connect();
    const probe = client
      .queryUsers({ limit: 1 }, undefined, {
        signal: AbortSignal.timeout(PRESENCE_PROBE_TIMEOUT_MS),
      })
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

function nextActionsFor(
  project: ProjectStatus,
  users: UserPresence,
  cliVersion: string,
  selector: EnvironmentSelector,
): string[] {
  if (project.lifecycle === "not-configured") {
    return project.environment === undefined && project.env_file === undefined
      ? [
          "From your app directory, run setup; the CLI will detect the framework or ask in an empty directory.",
        ]
      : [];
  }
  if (project.lifecycle !== "configured") {
    return [];
  }
  // Additive to the journey staging rather than a stage of its own: attaching a
  // team is orthogonal to whether login works yet, so it appends to whichever
  // stage the user is in instead of displacing it. A closed window flips the
  // nudge to reconciliation wording, which still tells the user to run
  // `claim`: the local record may be stale (claimed from another machine
  // reads detached), and the server resolves the grant before the window,
  // so the command is the authoritative check, never a guaranteed failure.
  const claim =
    project.claim?.kind === "detached"
      ? project.claim.claimable
        ? [
            claimAction(
              cliVersion,
              project.claim.deadline === undefined ? undefined : new Date(project.claim.deadline),
              selector,
            ),
          ]
        : [claimWindowClosedAction(cliVersion, selector)]
      : [];
  if (users === "none") {
    return [verifyLoginAction(project.issuer), ...claim];
  }
  if (users === "some") {
    return [...customizeAndPublishActions(cliVersion, selector), ...claim];
  }
  return claim;
}

function nextCommandsFor(
  serverLifecycle: string,
  project: ProjectStatus,
  users: UserPresence,
  cliVersion: string,
  // The `--env`/`--env-file`/`--server` suffix this run was invoked with (empty
  // for the default environment). Carried into every project-scoped follow-up so
  // an agent running them stays on the environment `status` reported, rather than
  // silently falling back to the default development project.
  selector: EnvironmentSelector,
  cwdSuffix: string,
): SuggestedCommand[] {
  const commands: SuggestedCommand[] = [];
  if (serverLifecycle !== "running") {
    commands.push(unscopedCommand(`start${cwdSuffix}`, cliVersion));
  }
  if (project.lifecycle === "not-configured" && project.environment !== undefined) {
    commands.push(
      unscopedCommand(`env add ${shellArg(project.environment)}${cwdSuffix}`, cliVersion),
    );
  } else if (project.lifecycle === "not-configured") {
    if (project.env_file === undefined) {
      commands.push(unscopedCommand(`setup --server local${cwdSuffix}`, cliVersion));
    }
  } else if (project.lifecycle === "orphaned-config") {
    commands.push(
      unscopedCommand(`setup --force${cwdSuffix}`, cliVersion),
      projectCommand("doctor --fix", selector, cliVersion),
    );
  } else {
    commands.push(projectCommand("doctor", selector, cliVersion));
    // Suggested even when the local record says the window has closed: the
    // record can be stale (claimed from another machine reads detached), and
    // `claim` is the safe reconciliation — the server checks the grant
    // before the window, so an attached project answers with a clean skip.
    if (project.claim?.kind === "detached") {
      commands.push(claimCommand(cliVersion, selector));
    }
    if (users === "none") {
      // Staged like next_actions: before the first login is proven in a
      // browser, publishing is premature — `plan` previews safely and the
      // verify mission lives in next_actions. `apply` joins once users
      // exist ("some") or when the probe can't tell ("unknown" keeps the
      // lifecycle-only behavior rather than withholding on no signal).
      commands.push(projectCommand("plan", selector, cliVersion));
    } else {
      commands.push(projectCommand("apply", selector, cliVersion));
    }
  }
  return commands;
}
