import pTimeout from "p-timeout";

import { UserService } from "@/lib/backend";
import {
  claimAction,
  claimCommand,
  claimState,
  claimWindowClosedAction,
  type ClaimState,
} from "@/lib/claim-state";
import { Cmd } from "@/lib/cmd";
import { isCancellation } from "@/lib/errors";
import {
  customizeAndPublishActions,
  exploreAllCommands,
  verifyLoginAction,
} from "@/lib/journey-guidance";
import {
  DEFAULT_LOCAL_SERVER_URL,
  readRuntimeMetadata,
  runtimeSummary,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import {
  type Admitted,
  type Connection,
  CommandGroups,
  EnvironmentCommand,
  type JsonEnvelope,
  type MetaOptions,
} from "@/lib/oclif";
import type { GlobalOptions } from "@/lib/oclif/types";
import { resolveCwd } from "@/lib/paths";
import {
  hasZitadelConfig,
  hasZitadelSecret,
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
} from "@/lib/project";
import {
  type EnvironmentSelector,
  projectCommand,
  type SuggestedCommand,
  unscopedCommand,
} from "@/lib/suggestion";
import { DEPLOY_ARGS } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * `zitadel status` — summarize the local server and project state.
 *
 * This is intentionally informational: a missing `zitadel.json`, stopped
 * local server, or orphaned config should be visible without making `status`
 * itself fail.
 */
export default class Status extends EnvironmentCommand {
  static override description = "Summarize the local Zitadel server and project state.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 3;

  protected override async toMeta(
    flags: Record<string, unknown>,
    options: MetaOptions = {},
  ): Promise<GlobalOptions> {
    if (flags.server !== "local") {
      return super.toMeta(flags, options);
    }
    const runtime = await readRuntimeMetadata(
      resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined),
    );
    return super.toMeta(flags, {
      resolveServer: false,
      source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
    });
  }

  protected async execute({ flags }: Admitted<typeof Status>): Promise<JsonEnvelope> {
    const server = await LocalServer.at(this.cwd, {
      cliVersion: this.cliVersion,
    }).status();
    const serverLifecycle = server.lifecycle;

    const project = await projectStatus(
      this.cwd,
      this.environment.values.ZITADEL_ISSUER?.value,
      this.environment.values.ZITADEL_PROJECT_ID?.value,
      this.environment.envFile !== undefined || this.environment.name.value !== "development"
        ? { name: this.environment.name.value, envFile: this.environment.envFile }
        : undefined,
    );
    this.ui.ranAgainst(
      project.lifecycle === "configured" ? project.project_id : undefined,
      (this.environment.values.ZITADEL_URL?.value ?? this.meta.source).replace(/^https?:\/\//, ""),
    );
    const users =
      project.lifecycle === "configured"
        ? await detectUserPresence(() => {
            return this.connect({
              prompt: false,
              timeoutMs: PRESENCE_PROBE_TIMEOUT_MS,
            });
          })
        : "unknown";
    const nextCommands = nextCommandsFor(
      serverLifecycle,
      project,
      users,
      this.cliVersion,
      this.environmentSelector(),
      // `--cwd` as typed, for the follow-ups the selector does not carry: the
      // runtime and the project files they act on live in that directory.
      typeof flags.cwd === "string" ? ` ${Cmd.option("--cwd", flags.cwd)}` : "",
    );
    const nextActions = nextActionsFor(project, users, this.cliVersion, this.environmentSelector());

    const serverUrl =
      server.runtime === undefined ? undefined : escapeControlCharacters(server.runtime.server_url);
    const backend = server.runtime?.backend;
    const how =
      server.runtime?.backend === "binary" && server.process !== undefined
        ? `${backend}, pid ${server.process.pid}`
        : backend;
    const serverSaid = {
      missing: "No local server was started in this directory",
      stopped: `The local server is stopped, and last ran at ${serverUrl} (${how})`,
      unhealthy: `The local server is running at ${serverUrl} (${how}) but does not answer`,
      running: `The local server is running and healthy at ${serverUrl} (${how})`,
    }[server.lifecycle];
    let dockerSaid = "";
    if (backend === "docker" && !server.docker.available) {
      dockerSaid = `, and Docker could not be asked about it${server.docker.error === undefined ? "" : `: ${escapeControlCharacters(server.docker.error)}`}`;
    }
    const projectSaid = [
      ...("project_id" in project && project.project_id !== undefined
        ? [`Project ${project.project_id}`]
        : []),
      `lifecycle ${project.lifecycle}`,
      ...("issuer" in project && project.issuer !== undefined ? [`issuer ${project.issuer}`] : []),
    ];

    return this.emit({
      status: "ok",
      data: {
        title: "Checked the status of the project",
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
      },
      summary: {
        title: "Checked the status of the project",
        sections: [],
        lines: [
          `${serverSaid}${dockerSaid}.`,
          escapeControlCharacters(`${projectSaid.join(", ")}.`),
        ],
        overview: exploreAllCommands(this.cliVersion),
      },
      next: {
        actions: nextActions,
        commands: nextCommands,
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
    const userService = new UserService(client);
    const probe = userService
      .exists()
      .then((exists): UserPresence => {
        return exists ? "some" : "none";
      })
      .catch((error: unknown): UserPresence => {
        // Cancelling is not an unknown answer: the person asked `status` to
        // stop, so it stops rather than reporting a lifecycle it guessed at.
        if (isCancellation(error)) {
          throw error;
        }
        return "unknown";
      });
    // The probe's own connection gives up after PRESENCE_PROBE_TIMEOUT_MS, so
    // a server that never answers neither holds `status` nor keeps the process
    // alive once the answer is settled. The timer is the outer bound: DNS
    // resolution can outlive a request deadline, and `status` stays snappy.
    return await pTimeout(probe, {
      milliseconds: PRESENCE_PROBE_TIMEOUT_MS + 250,
      fallback: (): UserPresence => {
        return "unknown";
      },
    });
  } catch (error) {
    if (isCancellation(error)) {
      throw error;
    }
    return "unknown";
  }
}

function nextActionsFor(
  project: ProjectStatus,
  users: UserPresence,
  cliVersion: string,
  // Appended to the `claim` the prose nudge quotes: the action text is a
  // pasteable command, so it must carry the same environment selector the
  // machine `next_commands` do, or a reader copying it retargets the project.
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
      unscopedCommand(`env add ${Cmd.quote(project.environment)}${cwdSuffix}`, cliVersion),
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
      // browser, publishing is premature — `deploy --dry-run` previews safely
      // and the verify mission lives in next_actions. A full `deploy` joins
      // once users exist ("some") or when the probe can't tell ("unknown"
      // keeps the lifecycle-only behavior rather than withholding on no signal).
      commands.push(projectCommand("deploy --dry-run", selector, cliVersion));
    } else {
      commands.push(projectCommand(DEPLOY_ARGS, selector, cliVersion));
    }
  }
  return commands;
}
