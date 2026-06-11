import { inspectContainer } from "../lib/local-server/docker";
import {
  DEFAULT_LOCAL_SERVER_URL,
  checkLocalServerHealth,
  localContainerName,
  readRuntimeMetadata,
  runtimeSummary,
} from "../lib/local-server/runtime";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import {
  hasZitadelConfig,
  hasZitadelSecret,
  readDevelopmentIssuer,
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
    const runtime = await readRuntimeMetadata(flags.cwd ? String(flags.cwd) : process.cwd());
    if (flags.server === "local") {
      await this.toMeta(flags, {
        resolveServer: false,
        source: runtime?.server_url ?? DEFAULT_LOCAL_SERVER_URL,
      });
    } else {
      await this.toMeta(flags);
    }
    const { cwd } = this.meta;

    const containerName = runtime?.container_name ?? localContainerName(cwd);
    let docker: Awaited<ReturnType<typeof inspectContainer>> | undefined;
    let dockerError: string | undefined;
    try {
      docker = await inspectContainer(containerName);
    } catch (error) {
      dockerError = error instanceof Error ? error.message : String(error);
    }
    const healthy = runtime ? await checkLocalServerHealth(runtime.server_url) : false;
    const serverLifecycle = runtime
      ? docker?.running && healthy
        ? "running"
        : docker?.exists
          ? "unhealthy"
          : "stopped"
      : "missing";

    const project = await projectStatus(cwd);
    const nextCommands = nextCommandsFor(serverLifecycle, project.lifecycle, this.meta.cliVersion);
    const nextActions = nextActionsFor(project.lifecycle);

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
  return {
    lifecycle: "configured",
    project_id: String(config.project ?? secret.project_id ?? ""),
    issuer: readDevelopmentIssuer(config),
  };
}

function nextActionsFor(projectLifecycle: ProjectStatus["lifecycle"]): string[] {
  if (projectLifecycle === "not-configured") {
    return [
      "From your app directory, run setup; the CLI will detect the framework or ask in an empty directory.",
    ];
  }
  return [];
}

function nextCommandsFor(
  serverLifecycle: string,
  projectLifecycle: ProjectStatus["lifecycle"],
  cliVersion: string,
): string[] {
  const commands: string[] = [];
  if (serverLifecycle !== "running") {
    commands.push(publicCliCommand("start", cliVersion));
  }
  if (projectLifecycle === "not-configured") {
    commands.push(publicCliCommand("setup --server local", cliVersion));
  } else if (projectLifecycle === "orphaned-config") {
    commands.push(
      publicCliCommand("setup --force", cliVersion),
      publicCliCommand("doctor --fix", cliVersion),
    );
  } else {
    commands.push(publicCliCommand("doctor", cliVersion), publicCliCommand("apply", cliVersion));
  }
  return commands;
}
