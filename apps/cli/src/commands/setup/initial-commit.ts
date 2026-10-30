import { ZitadelError } from "../../lib/errors";
import { type Author, Repository } from "../../lib/git";
import { isLocalRuntimePath, isSecretPath } from "../../lib/secret-paths";

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
  /** git is missing, or init/add/commit failed, or a secret would have been committed. */
  | { readonly kind: "unavailable"; readonly reason: string };

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

/**
 * Refuse a project whose repository has anything uncommitted, before setup
 * writes a single file.
 *
 * Setup commits what it wrote so the first release records a real commit, and
 * the honest way to know what it wrote is that the tree was clean beforehand:
 * then everything uncommitted afterwards is setup's own work and nothing of
 * the developer's is swept in. A dirty tree makes that impossible to tell
 * apart, and committing someone's work-in-progress under setup's name is worse
 * than any diff it would buy. Checked up front rather than at commit time, so
 * a refusal costs nothing and leaves no half-made project behind.
 *
 * When git cannot answer, setup refuses rather than carries on: the commit
 * does not check again, so going ahead would stage and commit the very work
 * this guard exists to protect.
 */
export async function assertCleanWorktree(cwd: string): Promise<void> {
  const repository = await Repository.open(cwd);
  if (repository === null) {
    return;
  }
  const files = await repository.uncommittedFiles().catch((error: unknown) => {
    throw new ZitadelError(
      "E_CONFLICT",
      `Could not tell whether the git working tree is clean: ${messageOf(error)}`,
      {
        hint:
          "Setup commits the files it writes, and will not do that without knowing the tree " +
          "started clean. Fix what git is reporting, then run setup again, or pass --no-git to " +
          "set up without touching version control.",
      },
    );
  });
  const dirty = files.filter((file) => !isCliOwned(file.path));
  if (dirty.length === 0) {
    return;
  }
  const modified = dirty.filter((change) => !change.untracked).map((change) => change.path);
  const untracked = dirty.filter((change) => change.untracked).map((change) => change.path);
  const parts = [
    modified.length > 0 ? `${modified.length} uncommitted change${plural(modified)}` : undefined,
    untracked.length > 0 ? `${untracked.length} untracked file${plural(untracked)}` : undefined,
  ].filter((part) => part !== undefined);
  throw new ZitadelError("E_CONFLICT", `The git working tree has ${parts.join(" and ")}`, {
    hint:
      "Setup commits the project directory so the first release records a commit, and it will not " +
      "do that while there is work it did not write, which would be committed under setup's name. " +
      "Run `git status` to see them, commit or stash them, then run setup again. If you have just scaffolded " +
      "the app yourself, committing it first is the expected step. To set up without touching " +
      "version control at all, pass --no-git.",
    details: { modified, untracked },
  });
}

/** `s` unless the list holds exactly one entry. */
function plural(list: readonly unknown[]): string {
  return list.length === 1 ? "" : "s";
}

/**
 * Give the scaffolded project a git repository with one commit, so the release
 * setup builds next records a real `git_sha` and the deploy after it can diff
 * against this commit instead of reporting that no diff is available.
 *
 * A repository is created only when there is none; an existing one is used as
 * it stands, never nested inside. Either way the commit covers the project
 * directory, which is safe because {@link assertCleanWorktree} has already
 * refused a repository with anything uncommitted: everything there is to commit
 * by this point is what setup itself wrote.
 *
 * Nothing here prompts, so it behaves the same interactively and in CI, and no
 * failure is fatal: the worst case is the first release carrying no commit,
 * which is what happened before this existed. The reason is git's first line,
 * since it goes into a one-line warning.
 */
export async function ensureInitialCommit(cwd: string): Promise<InitialCommitOutcome> {
  try {
    const existing = await Repository.open(cwd);
    const repository = existing ?? (await Repository.create(cwd));
    const outcome = await repository.commitAll(INITIAL_COMMIT_SUBJECT, {
      except: isSecretPath,
      authorIfGitHasNone: FALLBACK_AUTHOR,
    });
    if (!outcome.committed) {
      return { kind: "unavailable", reason: outcome.reason };
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
    return { kind: "unavailable", reason: messageOf(error).split("\n")[0] ?? "" };
  }
}

/** git's own message, so the warning names the real cause. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
