import {
  type CreatedProject,
  createZitadelClient,
  InvalidError,
  PolicyService,
} from "@/lib/backend";
import { isCancellation, toZitadelError, ZitadelError } from "@/lib/errors";
import { normalizePublicCliProse } from "@/lib/public-cli";
import type { SuggestedCommand } from "@/lib/suggestion";
import { userAgent } from "@/lib/user-agent";
import { WHAT_CHANGED } from "@/lib/suggestion";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import {
  CONFIG_DIRECTORIES,
  Connection,
  DiskStore,
  FileExistsError,
  SignupPolicy,
} from "@/lib/zitadel";
import {
  flowsReadmeContent,
  policiesReadmeContent,
  schemasReadmeContent,
} from "@zitadel/config/defaults";
import { join } from "node:path";

import {
  type ScaffoldedConfiguration,
  scaffoldOf,
  setupRefusal,
  signInOf,
  README,
  setupRetryFlags,
} from "@/cli/commands/setup/shared";
import type { Fact, SetupAnswers, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "project" | "retry" | "newApp" | "patching">;

/**
 * Writes the project's default configuration under `.zitadel/`, and wraps a
 * failure with what to do about it.
 *
 * @remarks
 * Only these files are written, never a connection file: those are
 * tenant-owned, and setup neither writes over nor removes one, unless it is part
 * of a new app, which goes as a whole. What the patch wrote is taken back by the
 * patch step's undo.
 */
export class WriteConfiguration extends WizardStep<
  "configuration",
  Fact<"scaffolded">,
  Needs,
  SetupServices
> {
  readonly key = "configuration";

  /**
   * Write the configuration, or say what a dry run would.
   *
   * @param needs - The answers and the project.
   * @param services - What the command provides.
   * @returns The files written and the minimum password length.
   * @throws {@link ZitadelError} When a file cannot be written.
   */
  async run(needs: Needs, services: SetupServices): Promise<Fact<"scaffolded">> {
    const { answers, newApp, patching, project, retry } = needs;
    try {
      const scaffolded = services.dryRun
        ? {
            filesWritten: [],
            passwordMinLength: signInOf(answers).password_min_length,
          }
        : await this.writeConfiguration(answers, project, services);
      return {
        scaffolded,
      };
    } catch (error) {
      const cause = toZitadelError(error);
      const rerun = setupRetryFlags({
        ...retry,
        server: services.serverFlag ?? null,
      });
      patching?.fail();
      throw new ZitadelError(cause.code, `Default configuration setup failed: ${cause.message}`, {
        hint: this.failureHint(
          cause,
          newApp !== undefined,
          services.suggest({
            id: "setup",
            flags: rerun,
          }),
        ),
        nextCommands:
          cause.nextCommands ??
          (newApp === undefined
            ? [
                services.suggest({
                  id: "setup",
                  flags: {
                    ...rerun,
                    force: true,
                  },
                }),
              ]
            : []),
        details: cause.details,
      });
    }
  }

  /**
   * The hint for a default configuration that was not all written.
   *
   * @param cause - What stopped the write.
   * @param removedNewApp - Whether setup removed the new app it made.
   * @param rerun - The setup command that starts over with the flags this run had.
   * @returns The hint to show.
   */
  private failureHint(
    cause: ZitadelError,
    removedNewApp: boolean,
    rerun: SuggestedCommand,
  ): string {
    if (removedNewApp) {
      const removed =
        "The project was created but its default configuration (schema, login flow, " +
        "password policy) was not all written, so setup removed the new app again.";
      if (cause.hint !== undefined) {
        return `${removed} ${cause.hint}`;
      }
      return `${removed} Re-run setup as before to start over.`;
    }
    if (cause.hint !== undefined) {
      return cause.hint;
    }
    return (
      "The project was created but its default configuration (schema, login flow, " +
      `password and sign-up policies) was not all written. Rerun ${rerun} to start over; ` +
      "--force overwrites the schema and flow files setup scaffolds and keeps an " +
      "existing password or sign-up policy file. It does not cover a connection under .zitadel/idps/ -- those are " +
      "yours, so setup never replaces or removes one; delete it to scaffold a fresh " +
      "one, or keep it and enable the provider after setup to reuse it."
    );
  }

  /**
   * Whether the server takes a sign-up policy.
   *
   * @remarks
   * Asked by evaluating one with no settings, which stores nothing. The CLI's
   * own client accepted the body, so a server refusing it as malformed does
   * not know the operation yet. Any other failure says nothing about the
   * policy and is left for the deploy to report.
   *
   * @param server - The server's base URL.
   * @param project - The project just created, with the secret to ask as.
   * @param signal - Stops the question when the person interrupts the run.
   * @returns False when the server refuses the operation as unknown.
   */
  private async serverTakesSignupPolicy(
    server: string,
    project: CreatedProject,
    signal: AbortSignal,
  ): Promise<boolean> {
    const service = new PolicyService(
      createZitadelClient({
        userAgent: userAgent(),
        baseUrl: server,
        token: project.project_secret,
        signal,
      }),
      project.id,
    );
    try {
      await service.evaluate({
        operation: SignupPolicy.OPERATION,
        config: {},
        input: { solved_challenge: "zitadel_pow" },
      });
      return true;
    } catch (error) {
      if (isCancellation(error) || signal.aborted) {
        throw error;
      }
      return !(error instanceof InvalidError && error.serverCode === "req.invalid");
    }
  }

  /**
   * Write the project's default configuration under `.zitadel/`, and a README
   * into each of its directories, all through the configuration library.
   *
   * @remarks
   * Only files: the first deploy publishes them. The configuration is planned
   * again against what is on disk now, so it refuses what the plan before the
   * project was created would. A README already there is the developer's, and
   * is kept even under `--force`. The first deploy carries every policy file,
   * so a server that does not take the sign-up policy yet gets none: setup
   * goes on without it. A file `--force` keeps stays, and the server refuses
   * every deploy that carries it.
   *
   * @param answers - What to scaffold.
   * @param project - The project just created, whose server is asked whether
   *   it takes a sign-up policy.
   * @param services - What the command provides.
   * @returns The absolute paths written, and the minimum password length the
   *   policy holds.
   * @throws {@link ZitadelError} With `E_CONFLICT` when a file setup will not
   *   replace is there, or `E_VALIDATION` when a policy `--force` keeps is not
   *   valid.
   */
  private async writeConfiguration(
    answers: SetupAnswers,
    project: CreatedProject,
    services: SetupServices,
  ): Promise<ScaffoldedConfiguration> {
    const signupPolicy = await this.serverTakesSignupPolicy(
      answers.server,
      project,
      services.signal,
    );
    const scaffold = await scaffoldOf(services.cwd, services.force, answers, signupPolicy);
    if (!signupPolicy) {
      reportWarning(
        scaffold.signupPolicy === undefined
          ? `The server does not take a sign-up policy yet, so setup wrote none. Upgrade the server, then add ${SignupPolicy.PATH} and run ${services.suggest(
              {
                id: "deploy",
                flags: { message: WHAT_CHANGED },
              },
            )}.`
          : `The server does not take a sign-up policy yet, so every deploy fails while ${SignupPolicy.PATH} is there. Upgrade the server, or move the file out of ${CONFIG_DIRECTORIES.policies}/ until you do.`,
      );
    }
    const store = new DiskStore(services.cwd);
    const saved = await scaffold.change
      .save(store, {
        overwrite: services.force,
        createOnly: (document) => {
          return document instanceof Connection;
        },
      })
      .catch((error: unknown) => {
        throw setupRefusal(error, scaffold.connections);
      });
    const readmes = await Promise.all(
      [
        {
          directory: CONFIG_DIRECTORIES.schemas,
          text: schemasReadmeContent(),
        },
        {
          directory: CONFIG_DIRECTORIES.flows,
          text: flowsReadmeContent(),
        },
        {
          directory: CONFIG_DIRECTORIES.policies,
          text: policiesReadmeContent(),
        },
      ].map(async (readme): Promise<readonly string[]> => {
        const path = `${readme.directory}/${README}`;
        const text = normalizePublicCliProse(readme.text, services.cliVersion);
        try {
          await store.writeText(path, text, "create");
          return [path];
        } catch (error) {
          if (error instanceof FileExistsError) {
            return [];
          }
          throw error;
        }
      }),
    );
    return {
      filesWritten: [...saved, ...readmes.flat()].map((path) => {
        return join(services.cwd, path);
      }),
      passwordMinLength: scaffold.policy.minLength ?? null,
    };
  }
}
