import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import { errorMessage } from "@/lib/errors";
import { Repository, RepositoryError } from "@/lib/git";
import { isSecretPath } from "@/lib/secret-paths";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

/**
 * The subject of the commit setup makes. Conventional-commit style, like every
 * other commit this repository's tooling writes, and with no trailer of any
 * kind: the commit belongs to the developer, not to the tool that made it.
 */
export const INITIAL_COMMIT_SUBJECT = "chore: scaffold the project with Zitadel setup";

/**
 * The author the commit carries where git can build no identity of its own.
 */
const FALLBACK_AUTHOR = {
  name: "Zitadel Setup",
  email: "setup@zitadel.local",
} as const;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "cwd" | "dryRun" | "ui">;

/**
 * What {@link MakeInitialCommit} did, for setup to report.
 */
export type InitialCommitOutcome = Readonly<
  /** There was no repository, so one was created and the project committed. */
  | {
      /** What happened. */
      kind: "created";
      /** The commit's id. */
      sha: string;
      /** Whether git guessed the author from the machine. */
      guessedIdentity: boolean;
      /** Whether git could build no author, so the commit carries the fallback one. */
      invented: boolean;
    }
  /** The project was already in a repository, and was committed into it. */
  | {
      /** What happened. */
      kind: "committed";
      /** The commit's id. */
      sha: string;
      /** Whether git guessed the author from the machine. */
      guessedIdentity: boolean;
      /** Whether git could build no author, so the commit carries the fallback one. */
      invented: boolean;
    }
  /** `--no-git`, or a dry run. */
  | {
      /** What happened. */
      kind: "skipped";
    }
  /** No commit: git is missing, or init/add/commit failed, or a secret would have been committed. */
  | {
      /** What happened. */
      kind: "unavailable";
      /** Why there is no commit. */
      reason: string;
      /** Whether setup ran `git init` before it failed. */
      createdRepository: boolean;
    }
>;

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
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "commit";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Put the scaffolded project under version control, unless it already is or
   * `--no-git` said not to.
   *
   * @remarks
   * Gives the scaffolded project a git repository with one commit, so the release setup builds
   * next records a real `git_sha` and the deploy after it can diff against this commit instead of
   * reporting that no diff is available.
   *
   * A repository is created only when there is none; an existing one is used as it stands, never
   * nested inside. Either way the commit covers the project directory, which is safe because the
   * worktree inspection has already found nothing uncommitted: everything there is to commit by
   * this point is what setup itself wrote.
   *
   * Nothing here prompts, so it behaves the same interactively and in CI, and no failure is
   * fatal: the worst case is the first release carrying no commit, which a later deploy reports
   * as having no baseline. When the commit fails after setup ran `git init`, the outcome says
   * so, since the repository now exists, and the warning says setup left a new, empty repository
   * behind.
   *
   * The fallback author is a last resort, used only where git can build no identity of its own: a
   * bare CI container has no configured identity and often no passwd entry or hostname to guess
   * from, and there git refuses to commit. No commit means no `git_sha`, and the next deploy has
   * nothing to diff against.
   *
   * Makes the commit, and says what happened. git guesses an author from the machine when none is
   * configured and commits anyway, so the commit then exists but carries a name the developer did
   * not choose. That is said out loud, with the one command that fixes it.
   *
   * @param needs - The flags.
   * @returns What was done, never a failure.
   */
  async run(needs: Needs): Promise<Fact<"commit">> {
    if (needs.flags.git === false) {
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
    const outcome: InitialCommitOutcome = await Repository.open(this.deps.cwd)
      .then(async (existing) => {
        const repository = existing ?? (await Repository.create(this.deps.cwd));
        return repository
          .commitAll(INITIAL_COMMIT_SUBJECT, {
            except: isSecretPath,
            authorIfGitHasNone: FALLBACK_AUTHOR,
          })
          .then(
            (committed): InitialCommitOutcome => {
              return committed.committed
                ? {
                    kind: existing === null ? "created" : "committed",
                    sha: committed.sha,
                    guessedIdentity: committed.author !== "yours",
                    invented: committed.author === "fallback",
                  }
                : {
                    kind: "unavailable",
                    reason: committed.reason,
                    createdRepository: existing === null,
                  };
            },
            (error: unknown): InitialCommitOutcome => {
              return {
                kind: "unavailable",
                reason:
                  error instanceof RepositoryError
                    ? error.headline()
                    : (errorMessage(error).split("\n")[0] ?? ""),
                createdRepository: existing === null,
              };
            },
          );
      })
      .catch((error: unknown): InitialCommitOutcome => {
        return {
          kind: "unavailable",
          reason:
            error instanceof RepositoryError
              ? error.headline()
              : (errorMessage(error).split("\n")[0] ?? ""),
          createdRepository: false,
        };
      });
    if (outcome.kind === "created" || outcome.kind === "committed") {
      committing.done(`Committed the project as ${outcome.sha.slice(0, 7)}`);
      if (outcome.invented) {
        reportWarning(
          `git could build no author identity on this machine, so the commit was made as ${FALLBACK_AUTHOR.name} <${FALLBACK_AUTHOR.email}>. Set user.name and user.email, then run git commit --amend --reset-author to put your own name on it.`,
        );
      } else if (outcome.guessedIdentity) {
        reportWarning(
          "This machine has no git user.name/user.email, so git guessed the author from your " +
            "username and hostname. Set your identity and run git commit --amend --reset-author " +
            "to put your own name on the commit.",
        );
      }
    } else {
      committing.done("Left the project uncommitted");
    }
    if (outcome.kind === "unavailable") {
      const warning = `Could not commit the scaffolded project (${outcome.reason || "git gave no reason"}); the first release records no commit, so the next deploy cannot show a diff.`;
      reportWarning(
        outcome.createdRepository
          ? `${warning} Setup created a new, empty git repository here.`
          : warning,
      );
    }
    return {
      commit: outcome,
    };
  }
}
