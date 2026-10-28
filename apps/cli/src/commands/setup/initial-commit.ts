import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { ZitadelError } from "../../lib/errors";
import { shellCommand } from "../../lib/suggestion";
import { headSha } from "../../lib/release";

const run = promisify(execFile);

/**
 * The subject of the commit setup makes. Conventional-commit style, like every
 * other commit this repository's tooling writes, and with no trailer of any
 * kind: the commit belongs to the developer, not to the tool that made it.
 */
export const INITIAL_COMMIT_SUBJECT = "chore: scaffold the project with Zitadel setup";

/**
 * Paths that must never be committed, whatever `.gitignore` happens to say.
 *
 * `.zitadel/local/` holds the local admin credential and the server's data
 * directory. Only the `.gitignore` line `start` appends keeps it out, so a
 * project missing that line would otherwise commit the credential.
 */
function isSecretPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (path === ".zitadel/secret" || path.endsWith("/.zitadel/secret")) {
    return true;
  }
  if (isLocalRuntimePath(path)) {
    return true;
  }
  return name.startsWith(".env") && name !== ".env.example";
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
  | { readonly kind: "skipped" }
  /** git is missing, or init/add/commit failed, or a secret would have been committed. */
  | { readonly kind: "unavailable"; readonly reason: string };

/** One entry of `git status --porcelain`, split into what it means. */
type Change = { readonly path: string; readonly untracked: boolean };

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
 * `.zitadel/local/` at any depth, not only at the project root: a nested app
 * inside the project directory has its own, holding its own admin credential.
 */
function isLocalRuntimePath(path: string): boolean {
  return /(^|\/)\.zitadel\/local(\/|$)/.test(path);
}

/**
 * Run git in `cwd`, returning its stdout.
 *
 * `core.quotePath=false` stops git C-quoting any path holding a non-ASCII byte
 * or a space (`"caf\303\251.txt"`). A quoted path is not the path: it matches
 * no pathspec and no suffix test, so a secret under such a name would be
 * neither recognised nor unstaged.
 */
async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return stdout;
}

/**
 * Whether `cwd` already sits inside a git repository.
 *
 * Only git's own "not a git repository" counts as no. Every other failure — a
 * dubious-ownership refusal, a permission error, a broken `HOME` — is raised,
 * because answering "no" to one of those would skip the clean-tree check and
 * then `git init` a second repository nested inside the first.
 */
async function insideRepository(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
    return true;
  } catch (error) {
    const message = messageOf(error).toLowerCase();
    if (message.includes("not a git repository") || message.includes("enoent")) {
      return false;
    }
    throw error;
  }
}

/**
 * Where the project sits inside its repository (`apps/web/`, or `""` at the
 * root). `git status` reports paths from the repository root whatever
 * directory it runs in, so this is what turns one into a project-relative path.
 */
async function projectPrefix(cwd: string): Promise<string> {
  // Not caught: an empty prefix guessed after a failure would make every
  // subdirectory project look dirty. The caller refuses instead.
  return (await git(cwd, ["rev-parse", "--show-prefix"])).trim();
}

/**
 * Whether the developer has an identity of their own for git to commit with,
 * from config or from `GIT_AUTHOR_*`/`GIT_COMMITTER_*`/`EMAIL`.
 *
 * Without one git does not fail: it guesses from the username and hostname and
 * commits anyway. `user.useConfigOnly` is what turns that guess back into an
 * error, so asking under it is the way to tell a real identity from a guessed
 * one. Nothing is passed to the commit either way — an identity this invented
 * would be a worse author than the one git derives from the machine.
 */
async function hasOwnIdentity(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["-c", "user.useConfigOnly=true", "var", "GIT_AUTHOR_IDENT"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether git can produce any identity at all, its own guess included.
 *
 * A bare CI container has no configured identity and often no passwd entry or
 * hostname to guess from, and there git refuses to commit. Only then is an
 * identity supplied, because no commit means no `git_sha` and the next deploy
 * has nothing to diff against.
 */
async function canBuildIdentity(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["var", "GIT_AUTHOR_IDENT"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Last resort, used only where git can build no identity of its own.
 *
 * Passed as environment variables rather than `-c user.*`, because an
 * inherited `GIT_AUTHOR_NAME=` (empty, as some runners leave it) outranks
 * `-c` and git then refuses with "empty ident name". The environment beats
 * both the config and whatever was inherited.
 */
const FALLBACK_IDENTITY: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "Zitadel Setup",
  GIT_AUTHOR_EMAIL: "setup@zitadel.local",
  GIT_COMMITTER_NAME: "Zitadel Setup",
  GIT_COMMITTER_EMAIL: "setup@zitadel.local",
};

/**
 * Everything git considers a change under the project directory, untracked
 * files included. An untracked file counts: setup stages the whole project, so
 * one left lying about would be swept into setup's commit.
 *
 * Scoped to `.` so that in a monorepo a sibling package's work-in-progress —
 * which `git add` here would never touch — does not refuse the setup.
 */
async function changes(cwd: string): Promise<Change[]> {
  // `--untracked-files=all` lists the files inside an untracked directory
  // rather than collapsing them to one `apps/web/` entry, which strips to ""
  // and would report "1 untracked file" naming nothing. A brand-new package is
  // still refused, deliberately: setup commits the whole project directory and
  // will not sweep up an app it did not write. The flag only makes the refusal
  // name the files the developer has to deal with.
  const stdout = await git(cwd, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
  ]);
  const fields = stdout.split("\0");
  const found: Change[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (entry === undefined || entry === "") {
      continue;
    }
    const status = entry.slice(0, 2);
    // A rename or copy is one record carrying two NUL-terminated paths, the
    // destination then the source. Read the destination and step over the
    // source, or it would be taken for a record of its own.
    if (status.includes("R") || status.includes("C")) {
      index += 1;
    }
    found.push({ path: entry.slice(3), untracked: status === "??" });
  }
  return found;
}

/** The paths staged in `cwd`, relative to it and never quoted. */
async function stagedPaths(cwd: string, env?: NodeJS.ProcessEnv): Promise<string[]> {
  // `--relative` both restricts the list to this directory and reports each
  // path relative to it, which is what `git reset -- <path>` resolves against:
  // a repository-root path handed back to reset from a subdirectory matches
  // nothing, exits 0, and leaves the file staged.
  const stdout = await git(
    cwd,
    ["diff", "--cached", "-z", "--name-only", "--no-renames", "--relative"],
    env,
  );
  return stdout.split("\0").filter((path) => path !== "");
}

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
 */
export async function assertCleanWorktree(cwd: string): Promise<void> {
  if (!(await insideRepository(cwd))) {
    return;
  }
  let dirty: Change[];
  try {
    const prefix = await projectPrefix(cwd);
    dirty = (await changes(cwd))
      .map((change) => ({
        ...change,
        path: change.path.startsWith(prefix) ? change.path.slice(prefix.length) : change.path,
      }))
      .filter((change) => !isCliOwned(change.path));
  } catch (error) {
    // Refuse rather than carry on. The commit does not check again, so going
    // ahead here would stage and commit the very work this guard exists to
    // protect, on the strength of a question git declined to answer.
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
  }
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
      "Look at them, commit or stash them, then run setup again. If you have just scaffolded " +
      "the app yourself, committing it first is the expected step. To set up without touching " +
      "version control at all, pass --no-git.",
    nextCommands: [shellCommand("git status")],
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
 * which is what happened before this existed.
 */
export async function ensureInitialCommit(cwd: string): Promise<InitialCommitOutcome> {
  let scratch: string | undefined;
  try {
    // Inside the try: this can now raise on a git that answers nothing, and
    // this function reports rather than throws.
    const existing = await insideRepository(cwd);
    if (!existing) {
      await git(cwd, ["init", "--quiet"]);
    }
    // The commit is assembled in a throwaway index, never the developer's.
    //
    // Their index may already hold staged work from another package, and a
    // commit built from it would take that too. Scoping the commit with a
    // pathspec instead is not an option: `git commit -- .` commits the working
    // tree of the matching paths and ignores the index entirely, so the reset
    // below would not keep an already-tracked secret out of it.
    scratch = await mkdtemp(join(tmpdir(), "zitadel-commit-"));
    const index: NodeJS.ProcessEnv = { GIT_INDEX_FILE: join(scratch, "index") };
    // Start from what is committed, so the commit carries the rest of the
    // repository unchanged. An unborn branch has no HEAD and starts empty.
    if (existing) {
      await git(cwd, ["read-tree", "HEAD"], index).catch(() => undefined);
    }
    await git(cwd, ["add", "--all", "--", "."], index);
    // `.gitignore` is the first line of defence and the scaffold writes one,
    // but a secret committed once cannot be scrubbed later, so what is about
    // to be committed is checked rather than trusted.
    const paths = await stagedPaths(cwd, index);
    const secrets = paths.filter(isSecretPath);
    if (secrets.length > 0) {
      await git(cwd, ["reset", "--quiet", "--", ...secrets], index);
    }
    // Verified rather than assumed: `git reset` reports success for a
    // pathspec that matched nothing, so a path the index does not hold under
    // that spelling would otherwise be committed in silence.
    const stillStaged = (await stagedPaths(cwd, index)).filter(isSecretPath);
    if (stillStaged.length > 0) {
      return {
        kind: "unavailable",
        reason: `${stillStaged[0]} could not be kept out of the commit, so nothing was committed`,
      };
    }
    if (paths.length === secrets.length) {
      return { kind: "unavailable", reason: "there was nothing to commit" };
    }
    const guessedIdentity = !(await hasOwnIdentity(cwd));
    const invented = !(await canBuildIdentity(cwd));
    // Signing is disabled for this commit alone: a configured GPG key would
    // otherwise block setup on a passphrase prompt it never asked for.
    await git(
      cwd,
      [
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "--no-verify",
        `--message=${INITIAL_COMMIT_SUBJECT}`,
      ],
      { ...index, ...(invented ? FALLBACK_IDENTITY : {}) },
    );
    const sha = await headSha(cwd);
    if (sha === null) {
      return { kind: "unavailable", reason: "the commit left no HEAD to record" };
    }
    // The developer's index still describes the old HEAD for these paths, so
    // without this they would see setup's own commit staged for deletion.
    // Scoped to the project, so another package's staged work is left as it is.
    await git(cwd, ["reset", "--quiet", "--", "."]).catch(() => undefined);
    return { kind: existing ? "committed" : "created", sha, guessedIdentity, invented };
  } catch (error) {
    return { kind: "unavailable", reason: messageOf(error) };
  } finally {
    if (scratch) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

/** git's own stderr where it has one, so the warning names the real cause. */
function messageOf(error: unknown): string {
  const stderr =
    typeof error === "object" && error !== null
      ? (error as { stderr?: unknown }).stderr
      : undefined;
  if (typeof stderr === "string" && stderr.trim() !== "") {
    return stderr.trim().split("\n")[0] ?? stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
