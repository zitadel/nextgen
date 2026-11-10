import { errorMessage } from "@/lib/errors";
import { type Author, Repository, RepositoryError } from "@/lib/git";
import { isLocalRuntimePath, isSecretPath } from "@/lib/secret-paths";

/**
 * The subject of the commit setup makes. Conventional-commit style, like every
 * other commit this repository's tooling writes, and with no trailer of any
 * kind: the commit belongs to the developer, not to the tool that made it.
 */
export const INITIAL_COMMIT_SUBJECT = "chore: scaffold the project with zitadel setup";

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
  | { readonly kind: "skipped" }
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
 * Paths the CLI writes itself, which therefore do not count as the
 * developer's uncommitted work. Matched against a path already made relative
 * to the project directory, never the repository root: in a monorepo the two
 * differ, and comparing the wrong one refuses every subdirectory project.
 *
 * Just the two `start` leaves behind: the `.zitadel/local/` it writes and the
 * `.gitignore` line that ignores it. It runs immediately before `setup` on the
 * documented golden path, so counting those would refuse every project that
 * has ever been started. Nothing else under `.zitadel/` is exempt: a
 * connection in `.zitadel/idps/` or a policy file is the developer's, and an
 * uncommitted edit there must not be committed under setup's subject.
 */
function isCliOwned(path: string): boolean {
  return path === ".gitignore" || path.endsWith("/.gitignore") || isLocalRuntimePath(path);
}

/**
 * Last resort, used only where git can build no identity of its own: a bare
 * CI container has no configured identity and often no passwd entry or
 * hostname to guess from, and there git refuses to commit. No commit means no
 * `git_sha`, and the next deploy has nothing to diff against.
 */
const FALLBACK_AUTHOR: Author = { name: "Zitadel Setup", email: "setup@zitadel.local" };

/** What the git working tree of a project holds, as setup needs to know before it writes. */
export type WorktreeState =
  | { readonly kind: "no-repository" }
  | { readonly kind: "unknown"; readonly reason: string }
  | { readonly kind: "blocked"; readonly blocked: string }
  | {
      readonly kind: "dirty";
      readonly modified: readonly string[];
      readonly untracked: readonly string[];
    }
  | { readonly kind: "clean" };

/**
 * Reports what the repository of a project holds, before setup writes a single
 * file.
 *
 * Setup commits what it wrote so the first release records a real commit, and
 * the honest way to know what it wrote is that the tree was clean beforehand:
 * then everything uncommitted afterwards is setup's own work and nothing of
 * the developer's is swept in. A dirty tree makes that impossible to tell
 * apart, and committing someone's work-in-progress under setup's name is worse
 * than any diff it would buy. Asked up front rather than at commit time, so
 * a refusal costs nothing and leaves no half-made project behind.
 *
 * A repository where a commit would land where it should not (during a
 * merge, rebase, cherry-pick, revert or bisect, or on a detached HEAD) is
 * `blocked` for the same reason: found only at commit time, setup would
 * already have done all its work.
 *
 * When git cannot answer, the state is `unknown`: the commit does not check
 * again, so going ahead would stage and commit the very work this guard exists
 * to protect.
 */
export async function inspectWorktree(cwd: string): Promise<WorktreeState> {
  const repository = await Repository.open(cwd);
  if (repository === null) {
    return { kind: "no-repository" };
  }
  try {
    const blocked = await repository.readyToCommit();
    if (blocked !== null) {
      return { kind: "blocked", blocked };
    }
    const files = await repository.uncommittedFiles();
    const dirty = files.filter((file) => !isCliOwned(file.path));
    if (dirty.length === 0) {
      return { kind: "clean" };
    }
    return {
      kind: "dirty",
      modified: dirty.filter((change) => !change.untracked).map((change) => change.path),
      untracked: dirty.filter((change) => change.untracked).map((change) => change.path),
    };
  } catch (error) {
    return { kind: "unknown", reason: messageOf(error) };
  }
}

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
 * which is what happened before this existed. When the commit fails after
 * setup ran `git init`, the outcome says so, since the repository now exists.
 */
export async function ensureInitialCommit(cwd: string): Promise<InitialCommitOutcome> {
  try {
    const existing = await Repository.open(cwd);
    const repository = existing ?? (await Repository.create(cwd));
    const outcome = await repository
      .commitAll(INITIAL_COMMIT_SUBJECT, {
        except: isSecretPath,
        authorIfGitHasNone: FALLBACK_AUTHOR,
      })
      .catch((error: unknown) => ({ committed: false as const, reason: firstLineOf(error) }));
    if (!outcome.committed) {
      return { kind: "unavailable", reason: outcome.reason, createdRepository: existing === null };
    }
    const commit = {
      sha: outcome.sha,
      guessedIdentity: outcome.author !== "yours",
      invented: outcome.author === "fallback",
    };
    if (existing === null) {
      return { kind: "created", ...commit };
    }
    return { kind: "committed", ...commit };
  } catch (error) {
    return { kind: "unavailable", reason: firstLineOf(error), createdRepository: false };
  }
}

/** The one line that says why the commit failed, since it goes into a one-line warning. */
function firstLineOf(error: unknown): string {
  if (error instanceof RepositoryError) {
    return error.headline();
  }
  return messageOf(error).split("\n")[0] ?? "";
}

/** git's own message, so the warning names the real cause. */
function messageOf(error: unknown): string {
  return errorMessage(error);
}

/** What `setup --json` reports under `git`: whether setup ran `git init`, even if the commit then failed, and the commit, or null. */
export function gitReport(outcome: InitialCommitOutcome): {
  readonly initialized: boolean;
  readonly commit: string | null;
} {
  if (outcome.kind === "created") {
    return { initialized: true, commit: outcome.sha };
  }
  if (outcome.kind === "committed") {
    return { initialized: false, commit: outcome.sha };
  }
  if (outcome.kind === "unavailable") {
    return { initialized: outcome.createdRepository, commit: null };
  }
  return { initialized: false, commit: null };
}

/** The warning for a commit that could not be made, saying so when setup left a new, empty repository behind. */
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
