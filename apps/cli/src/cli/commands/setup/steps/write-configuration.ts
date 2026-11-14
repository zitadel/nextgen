import { createZitadelClient, InvalidError, PolicyService } from "@/lib/backend";
import { isCancellation, toZitadelError, ZitadelError } from "@/lib/errors";
import { normalizePublicCliProse } from "@/lib/public-cli";
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

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import {
  README,
  scaffoldOf,
  setupRefusal,
  setupRetryFlags,
  signInOf,
} from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "project" | "retry" | "newApp" | "patching">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "cliVersion" | "cwd" | "dryRun" | "force" | "serverFlag" | "signal" | "suggest"
>;

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
export class WriteConfiguration extends WizardStep<"configuration", Fact<"scaffolded">, Needs> {
  readonly key = "configuration";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Write the configuration, or say what a dry run would.
   *
   * @remarks
   * Only files are written: the first deploy publishes them. The configuration is planned
   * again against what is on disk now, so it refuses what the plan before the
   * project was created would. A README already there is the developer's, and
   * is kept even under `--force`.
   *
   * Whether the server takes a sign-up policy is asked by evaluating one with no settings, which
   * stores nothing. The CLI's own client accepted the body, so a server refusing it as malformed
   * does not know the operation yet. Any other failure says nothing about the policy and is left
   * for the deploy to report. The first deploy carries every policy file, so a server that does
   * not take the sign-up policy yet gets none: setup goes on without it. A file `--force` keeps
   * stays, and the server refuses every deploy that carries it.
   *
   * A failure is wrapped with the hint for a default configuration that was not all written: when
   * setup removed the new app it made, the hint says so and keeps the cause's own advice; otherwise
   * it names the setup command that starts over with the flags this run had. `--force` overwrites
   * the schema and flow files setup scaffolds and keeps an existing password or sign-up policy
   * file, and it does not cover a connection under `.zitadel/idps/`, which is the developer's.
   *
   * @param needs - The answers and the project.
   * @param this.deps - What the command provides.
   * @returns The absolute paths written and the minimum password length the policy holds.
   * @throws {@link ZitadelError} When a file cannot be written: with `E_CONFLICT` when a file setup
   *   will not replace is there, or `E_VALIDATION` when a policy `--force` keeps is not valid.
   */
  async run(needs: Needs): Promise<Fact<"scaffolded">> {
    const { answers, newApp, patching, project, retry } = needs;
    try {
      if (this.deps.dryRun) {
        return {
          scaffolded: {
            filesWritten: [],
            passwordMinLength: signInOf(answers).password_min_length,
          },
        };
      }
      const signupPolicy = await new PolicyService(
        createZitadelClient({
          userAgent: userAgent(),
          baseUrl: answers.server,
          token: project.project_secret,
          signal: this.deps.signal,
        }),
        project.id,
      )
        .evaluate({
          operation: SignupPolicy.OPERATION,
          config: {},
          input: { solved_challenge: "zitadel_pow" },
        })
        .then(
          () => {
            return true;
          },
          (error: unknown) => {
            if (isCancellation(error) || this.deps.signal.aborted) {
              throw error;
            }
            return !(error instanceof InvalidError && error.serverCode === "req.invalid");
          },
        );
      const scaffold = await scaffoldOf(this.deps.cwd, this.deps.force, answers, signupPolicy);
      if (!signupPolicy) {
        reportWarning(
          scaffold.signupPolicy === undefined
            ? `The server does not take a sign-up policy yet, so setup wrote none. Upgrade the server, then add ${SignupPolicy.PATH} and run ${this.deps.suggest(
                {
                  id: "deploy",
                  flags: { message: WHAT_CHANGED },
                },
              )}.`
            : `The server does not take a sign-up policy yet, so every deploy fails while ${SignupPolicy.PATH} is there. Upgrade the server, or move the file out of ${CONFIG_DIRECTORIES.policies}/ until you do.`,
        );
      }
      const store = new DiskStore(this.deps.cwd);
      const saved = await scaffold.change
        .save(store, {
          overwrite: this.deps.force,
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
          const text = normalizePublicCliProse(readme.text, this.deps.cliVersion);
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
        scaffolded: {
          filesWritten: [...saved, ...readmes.flat()].map((path) => {
            return join(this.deps.cwd, path);
          }),
          passwordMinLength: scaffold.policy.minLength ?? null,
        },
      };
    } catch (error) {
      const cause = toZitadelError(error);
      const rerun = setupRetryFlags({
        ...retry,
        server: this.deps.serverFlag ?? null,
      });
      patching?.fail();
      throw new ZitadelError(cause.code, `Default configuration setup failed: ${cause.message}`, {
        hint:
          newApp === undefined
            ? (cause.hint ??
              "The project was created but its default configuration (schema, login flow, " +
                `password and sign-up policies) was not all written. Rerun ${this.deps.suggest({
                  id: "setup",
                  flags: rerun,
                })} to start over; ` +
                "--force overwrites the schema and flow files setup scaffolds and keeps an " +
                "existing password or sign-up policy file. It does not cover a connection under .zitadel/idps/ -- those are " +
                "yours, so setup never replaces or removes one; delete it to scaffold a fresh " +
                "one, or keep it and enable the provider after setup to reuse it.")
            : "The project was created but its default configuration (schema, login flow, " +
              "password policy) was not all written, so setup removed the new app again. " +
              (cause.hint ?? "Re-run setup as before to start over."),
        nextCommands:
          cause.nextCommands ??
          (newApp === undefined
            ? [
                this.deps.suggest({
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
}
