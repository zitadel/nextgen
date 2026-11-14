import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import {
  retryOptionsFromFlags,
  setupRetryFlags,
  type SetupRetryOptions,
  ssoRecovery,
} from "@/cli/commands/setup/shared";
import { basename } from "node:path";
import { type CreatedProject, createZitadelClient, ProjectService } from "@/lib/backend";
import { toZitadelError, ZitadelError } from "@/lib/errors";

import { escapeControlCharacters } from "@/lib/terminal-text";
import { userAgent } from "@/lib/user-agent";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "app" | "answers" | "issuer">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "signal" | "suggest" | "ui">;

/**
 * Creates the project, which is not undone: remote projects are kept after a
 * failed setup, and the failure's hint says what to do about it.
 *
 * @remarks
 * `POST /projects` is unauthenticated. CLI-managed projects opt out of server
 * fallback defaults; setup writes the default configuration files and the first
 * deploy publishes them.
 */
export class CreateProject extends WizardStep<"project", Fact<"project" | "retry">, Needs> {
  readonly key = "project";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Create the project, or say that a dry run would.
   *
   * @remarks
   * Resolved values, not raw flags: the wizard may have picked the preset, use case, or dev port
   * interactively, and a retry must reproduce those choices — the issuer registered with the
   * project derives from the port.
   *
   * A dry run gets a deterministic stand-in project, so no remote call is made. The app's own
   * origin is registered as primary: only a primary pattern admits the requests the dev proxy
   * forwards from it, and a deploy goes to the project's primary origins. A preview pattern is for
   * the URLs a pull-request build deploys to, which this is not.
   *
   * The project is named after the directory, or after the framework when the directory has no
   * name. A refusal carries the hint to start a local server first and the commands to retry.
   *
   * @param needs - The flags, the app and the answers.
   * @param this.deps - What the command provides.
   * @returns The project, and what a retry has to carry.
   * @throws {@link ZitadelError} When the server refuses to create the project.
   */
  async run(needs: Needs): Promise<Fact<"project" | "retry">> {
    const { answers, app, flags, issuer } = needs;
    const retry: SetupRetryOptions = {
      ...retryOptionsFromFlags(flags),
      framework: app.framework,
      preset: answers.preset,
      useCase: answers.useCase,
      devPort: answers.devPort,
      sso: answers.sso.map((answer) => {
        return answer.selection;
      }),
      passwordMinLength: answers.passwordMinLength,
    };
    const creating = this.deps.ui.begin(
      `Creating project on ${escapeControlCharacters(answers.server)}${this.deps.dryRun ? " (dry run)" : ""}`,
    );
    try {
      const fromDirectory = basename(this.deps.cwd).trim();
      const project: CreatedProject = this.deps.dryRun
        ? {
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
          }
        : await new ProjectService(
            createZitadelClient({
              userAgent: userAgent(),
              baseUrl: answers.server,
              signal: this.deps.signal,
            }),
          )
            .create({
              name: fromDirectory.length > 0 ? fromDirectory : `zitadel-${app.framework}-app`,
              origins: [
                {
                  pattern: issuer,
                  kind: "primary",
                },
              ],
              seed_defaults: false,
            })
            .catch((error: unknown) => {
              const normalized = toZitadelError(error);
              const sso = ssoRecovery(retry, this.deps.suggest);
              throw new ZitadelError(normalized.code, normalized.message, {
                hint:
                  `${normalized.hint ? `${normalized.hint} ` : ""}` +
                  "If you meant to use a local Zitadel server, start it first " +
                  `and retry setup with the commands below. ${sso.hint}`.trimEnd(),
                nextCommands: [
                  this.deps.suggest({ id: "start" }),
                  this.deps.suggest({
                    id: "setup",
                    flags: setupRetryFlags(retry),
                  }),
                  ...sso.commands,
                ],
                details: {
                  server: answers.server,
                  original: normalized.details,
                },
              });
            });
      creating.done(
        this.deps.dryRun
          ? "Would create a project (dry run)"
          : `Created project ${escapeControlCharacters(project.id)}`,
      );
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
