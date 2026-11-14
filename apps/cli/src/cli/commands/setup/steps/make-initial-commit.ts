import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { inspectWorktree } from "@/cli/commands/setup/shared";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import { errorMessage } from "@/lib/errors";
import { Repository, RepositoryError } from "@/lib/git";
import { isSecretPath } from "@/lib/secret-paths";

/**
 * The subject of the commit setup makes. Conventional-commit style, like every
 * other commit this repository's tooling writes, and with no trailer of any
 * kind: the commit belongs to the developer, not to the tool that made it.
 */
export const INITIAL_COMMIT_SUBJECT = "chore: scaffold the project with Zitadel setup";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "ui">;

/**
 * Commits what setup wrote, so the release a later `deploy` builds records the
 * commit it came from; without it that deploy has no baseline and the one after
 * it can show no diff.
 *
 * @remarks
 * Narrated but never fatal: without the commit the first release simply
 * records no provenance, which is what setup did before.
 */
export class MakeInitialCommit extends WizardStep<"commit", Fact<"commit">, Needs> {
  readonly key = "commit";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Put the scaffolded project under version control, unless it already is or
   * `--no-git` said not to.
   *
   * @remarks
   * Makes the commit, and says what happened. git guesses an author from the machine when none is
   * configured and commits anyway, so the commit then exists but carries a name the developer did
   * not choose. That is said out loud, with the one command that fixes it.
   *
   * @param needs - The flags.
   * @param this.deps - What the command provides.
   * @returns What was done.
   */
  async run(needs: Needs): Promise<Fact<"commit">> {
    if (!needs.flags.git !== false) {
      return {
        commit: {
          kind: "skipped",
        },
      };
    }
    if (this.deps.dryRun) {
      this.deps.ui
        .begin("Committing the scaffolded project (dry run)")
        .done("Would initialise a git repository and commit the project (dry run)");
      return {
        commit: {
          kind: "skipped",
        },
      };
    }
    const committing = this.deps.ui.begin("Committing the scaffolded project");
    const outcome = await ensureInitialCommit(this.deps.cwd);
    if (outcome.kind !== "created" && outcome.kind !== "committed") {
      committing.done("Left the project uncommitted");
    }
    if (outcome.kind === "created" || outcome.kind === "committed") {
      committing.done(`Committed the project as ${outcome.sha.slice(0, 7)}`);
      if (outcome.invented) {
        reportWarning(
          "git could build no author identity on this machine, so the commit was made as " +
            "Zitadel Setup <setup@zitadel.local>. Set user.name and user.email, then run " +
            "git commit --amend --reset-author to put your own name on it.",
        );
      } else if (outcome.guessedIdentity) {
        reportWarning(
          "This machine has no git user.name/user.email, so git guessed the author from your " +
            "username and hostname. Set your identity and run git commit --amend --reset-author " +
            "to put your own name on the commit.",
        );
      }
    }
    if (outcome.kind === "unavailable") {
      reportWarning(unavailableWarning(outcome));
    }
    return {
      commit: outcome,
    };
  }
}

/** What {@link ensureInitialCommit} did, for setup to report. */
export type InitialCommitOutcome =
  /** There was no repository, so one was created and the project committed. */
  | {
      readonly kind: "created";
      readonly sha: string;
      readonly guessedIdentity: boolean;
      readonly invented: boolean;
    }
  /** The project was already in a repository, and was committed into it. */
  | {
      readonly kind: "committed";
      readonly sha: string;
      readonly guessedIdentity: boolean;
      readonly invented: boolean;
    }
  /** `--no-git`, or a dry run. */
  | {
      readonly kind: "skipped";
    }
  /**
   * No commit: git is missing, or init/add/commit failed, or a secret would have been committed.
   * `createdRepository` says whether setup ran `git init` before it failed.
   */
  | {
      readonly kind: "unavailable";
      readonly reason: string;
      readonly createdRepository: boolean;
    };

/**
 * Give the scaffolded project a git repository with one commit, so the release
 * setup builds next records a real `git_sha` and the deploy after it can diff
 * against this commit instead of reporting that no diff is available.
 *
 * A repository is created only when there is none; an existing one is used as
 * it stands, never nested inside. Either way the commit covers the project
 * directory, which is safe because {@link inspectWorktree} has already
 * found nothing uncommitted: everything there is to commit
 * by this point is what setup itself wrote.
 *
 * Nothing here prompts, so it behaves the same interactively and in CI, and no
 * failure is fatal: the worst case is the first release carrying no commit,
 * which a later deploy reports as having no baseline. When the commit fails after
 * setup ran `git init`, the outcome says so, since the repository now exists.
 *
 * The fallback author is a last resort, used only where git can build no identity of its own: a
 * bare CI container has no configured identity and often no passwd entry or hostname to guess
 * from, and there git refuses to commit. No commit means no `git_sha`, and the next deploy has
 * nothing to diff against.
 *
 * @param cwd - The project directory.
 * @returns What was done, never a failure.
 */
export async function ensureInitialCommit(cwd: string): Promise<InitialCommitOutcome> {
  try {
    const existing = await Repository.open(cwd);
    const repository = existing ?? (await Repository.create(cwd));
    const outcome = await repository
      .commitAll(INITIAL_COMMIT_SUBJECT, {
        except: isSecretPath,
        authorIfGitHasNone: {
          name: "Zitadel Setup",
          email: "setup@zitadel.local",
        },
      })
      .catch((error: unknown) => {
        return {
          committed: false as const,
          reason: firstLineOf(error),
        };
      });
    if (!outcome.committed) {
      return {
        kind: "unavailable",
        reason: outcome.reason,
        createdRepository: existing === null,
      };
    }
    return {
      kind: existing === null ? "created" : "committed",
      sha: outcome.sha,
      guessedIdentity: outcome.author !== "yours",
      invented: outcome.author === "fallback",
    };
  } catch (error) {
    return {
      kind: "unavailable",
      reason: firstLineOf(error),
      createdRepository: false,
    };
  }
}

/**
 * The one line that says why the commit failed, since it goes into a one-line warning.
 *
 * @param error - What stopped the commit.
 * @returns The first line of its message.
 */
function firstLineOf(error: unknown): string {
  if (error instanceof RepositoryError) {
    return error.headline();
  }
  return errorMessage(error).split("\n")[0] ?? "";
}

/**
 * The warning for a commit that could not be made, saying so when setup left a new, empty
 * repository behind.
 *
 * @param outcome - Why there was no commit, and whether setup created the repository.
 * @returns The warning to show.
 */
export function unavailableWarning(outcome: {
  readonly reason: string;
  readonly createdRepository: boolean;
}): string {
  const reason = outcome.reason || "git gave no reason";
  const warning = `Could not commit the scaffolded project (${reason}); the first release records no commit, so the next deploy cannot show a diff.`;
  if (outcome.createdRepository) {
    return `${warning} Setup created a new, empty git repository here.`;
  }
  return warning;
}
