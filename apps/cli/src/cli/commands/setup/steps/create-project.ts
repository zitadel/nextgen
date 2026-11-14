import {
  type SetupRetryOptions,
  retryOptionsOf,
  setupRetryFlags,
  ssoRecovery,
} from "@/cli/commands/setup/shared";
import { basename } from "node:path";
import { type CreatedProject, ProjectService, createZitadelClient } from "@/lib/backend";
import { toZitadelError, ZitadelError } from "@/lib/errors";
import type { Suggest } from "@/lib/suggestion";

import { escapeControlCharacters } from "@/lib/terminal-text";
import { userAgent } from "@/lib/user-agent";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "app" | "answers" | "issuer">;

/**
 * Creates the project, which is not undone: remote projects are kept after a
 * failed setup, and the failure's hint says what to do about it.
 *
 * @remarks
 * `POST /projects` is unauthenticated. CLI-managed projects opt out of server
 * fallback defaults; setup writes the default configuration files and the first
 * deploy publishes them.
 */
export class CreateProject extends WizardStep<
  "project",
  Fact<"project" | "retry">,
  Needs,
  SetupServices
> {
  readonly key = "project";

  /**
   * Create the project, or say that a dry run would.
   *
   *
   * @remarks
   * Resolved values, not raw flags: the wizard may have picked the preset, use case, or dev port
   * interactively, and a retry must reproduce those choices — the issuer registered with the
   * project derives from the port.
   *
   * @param needs - The flags, the app and the answers.
   * @param services - What the command provides.
   * @returns The project, and what a retry has to carry.
   */
  async run(needs: Needs, services: SetupServices): Promise<Fact<"project" | "retry">> {
    const { answers, app, flags, issuer } = needs;
    const retry: SetupRetryOptions = {
      ...retryOptionsOf(flags),
      framework: app.framework,
      preset: answers.preset,
      useCase: answers.useCase,
      devPort: answers.devPort,
      sso: answers.sso.map((answer) => {
        return answer.selection;
      }),
      passwordMinLength: answers.passwordMinLength,
    };
    const creating = services.ui.begin(
      `Creating project on ${escapeControlCharacters(answers.server)}${services.dryRun ? " (dry run)" : ""}`,
    );
    try {
      const unauthClient = createZitadelClient({
        userAgent: userAgent(),
        baseUrl: answers.server,
        signal: services.signal,
      });
      const projectName = defaultProjectName(services.cwd, app.framework);
      // Register the app's own origin so the backend's origin check allows
      // requests the dev proxy forwards from it.
      const project = services.dryRun
        ? dryRunProject(issuer)
        : await createProjectWithLocalHint(
            unauthClient,
            answers.server,
            services.suggest,
            projectName,
            issuer,
            retry,
          );
      creating.done(
        services.dryRun
          ? "Would create a project (dry run)"
          : `Created project ${escapeControlCharacters(project.id)}`,
      );
      services.projectCreated();
      return {
        project,
        retry,
      };
    } catch (error) {
      creating.fail();
      throw error;
    }
  }
}

async function createProjectWithLocalHint(
  client: ReturnType<typeof createZitadelClient>,
  server: string,
  suggest: Suggest,
  projectName: string,
  issuer: string,
  retry: SetupRetryOptions,
): Promise<CreatedProject> {
  const projectService = new ProjectService(client);
  try {
    // Register the app's own origin as primary: only a primary pattern admits
    // the requests the dev proxy forwards from it, and a deploy goes to the
    // project's primary origins. A preview pattern is for the URLs a
    // pull-request build deploys to, which this is not.
    return await projectService.create({
      name: projectName,
      origins: [
        {
          pattern: issuer,
          kind: "primary",
        },
      ],
      seed_defaults: false,
    });
  } catch (error) {
    const normalized = toZitadelError(error);
    const retryCommand = suggest({
      id: "setup",
      flags: setupRetryFlags(retry),
    });
    const sso = ssoRecovery(retry, suggest);
    throw new ZitadelError(normalized.code, normalized.message, {
      hint:
        `${normalized.hint ? `${normalized.hint} ` : ""}` +
        "If you meant to use a local Zitadel server, start it first " +
        `and retry setup with the commands below. ${sso.hint}`.trimEnd(),
      nextCommands: [suggest({ id: "start" }), retryCommand, ...sso.commands],
      details: {
        server,
        original: normalized.details,
      },
    });
  }
}

function defaultProjectName(cwd: string, framework: string): string {
  const fromDirectory = basename(cwd).trim();
  return fromDirectory.length > 0 ? fromDirectory : `zitadel-${framework}-app`;
}

/** A deterministic stand-in project for `--dry-run`, so no remote call is made. */
function dryRunProject(issuer: string): CreatedProject {
  return {
    id: "dry-run-0000",
    name: "dry-run",
    project_secret: "sk_proj_dry_run_full",
    preview_secret: "sk_proj_dry_run_preview",
    origins: [
      {
        pattern: issuer,
        kind: "primary",
      },
    ],
    created_at: "2026-04-21T14:03:11.000Z",
  };
}
