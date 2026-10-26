import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ZitadelError } from "../../lib/errors";

const run = promisify(execFile);

/**
 * The subject of the commit setup makes. Conventional-commit style, like every
 * other commit this repository's tooling writes, and with no trailer of any
 * kind: the commit belongs to the developer, not to the tool that made it.
 */
export const INITIAL_COMMIT_SUBJECT = "chore: scaffold the project with zitadel setup";

/**
 * Identity used only when the machine has none configured, because git refuses
 * to commit without one and no commit means no `git_sha` — the whole reason
 * this exists. It is reported back so setup can say the commit needs its author
 * corrected, rather than leaving an invented name in the history unmentioned.
 */
const FALLBACK_IDENTITY = { name: "Zitadel Setup", email: "setup@zitadel.local" };

/** Paths that must never be committed, whatever `.gitignore` happens to say. */
function isSecretPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (path === ".zitadel/secret" || path.endsWith("/.zitadel/secret")) {
    return true;
  }
  return name.startsWith(".env") && name !== ".env.example";
}

/** What {@link ensureInitialCommit} did, for setup to report. */
export type InitialCommitOutcome =
  /** There was no repository, so one was created and the project committed. */
  | { readonly kind: "created"; readonly sha: string; readonly fallbackIdentity: boolean }
  /** The project was already in a repository, and was committed into it. */
  | { readonly kind: "committed"; readonly sha: string; readonly fallbackIdentity: boolean }
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
 * `start` appends `.zitadel/local/` to `.gitignore` and writes the runtime
 * files under it, and it runs immediately before `setup` on the documented
 * golden path. Counting those would make setup refuse every project that has
 * ever been started, which is every project.
 */
function isCliOwned(path: string): boolean {
  return path === ".gitignore" || path === ".zitadel" || path.startsWith(".zitadel/");
}

/**
 * Run git in `cwd`, returning its stdout.
 *
 * `core.quotePath=false` stops git C-quoting any path holding a non-ASCII byte
 * or a space (`"caf\303\251.txt"`). A quoted path is not the path: it matches
 * no pathspec and no suffix test, so a secret under such a name would be
 * neither recognised nor unstaged.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** Whether `cwd` already sits inside a git repository. */
async function insideRepository(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the project sits inside its repository (`apps/web/`, or `""` at the
 * root). `git status` reports paths from the repository root whatever
 * directory it runs in, so this is what turns one into a project-relative path.
 */
async function projectPrefix(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--show-prefix"])).trim();
  } catch {
    return "";
  }
}

/** Whether git has an author identity of the developer's own to commit with. */
async function hasIdentity(cwd: string): Promise<boolean> {
  try {
    // `--get` takes its key as a separate argument. Written as `--get=user.email`
    // git exits 129 and this reports "no identity" on every machine, so every
    // commit would be attributed to FALLBACK_IDENTITY.
    const email = (await git(cwd, ["config", "--get", "user.email"])).trim();
    const name = (await git(cwd, ["config", "--get", "user.name"])).trim();
    return email !== "" && name !== "";
  } catch {
    return false;
  }
}

/**
 * Everything git considers a change under the project directory, untracked
 * files included. An untracked file counts: setup stages the whole project, so
 * one left lying about would be swept into setup's commit.
 *
 * Scoped to `.` so that in a monorepo a sibling package's work-in-progress —
 * which `git add` here would never touch — does not refuse the setup.
 */
async function changes(cwd: string): Promise<Change[]> {
  const stdout = await git(cwd, ["status", "--porcelain", "-z", "--", "."]);
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
async function stagedPaths(cwd: string): Promise<string[]> {
  // `--relative` both restricts the list to this directory and reports each
  // path relative to it, which is what `git reset -- <path>` resolves against:
  // a repository-root path handed back to reset from a subdirectory matches
  // nothing, exits 0, and leaves the file staged.
  const stdout = await git(cwd, [
    "diff",
    "--cached",
    "-z",
    "--name-only",
    "--no-renames",
    "--relative",
  ]);
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
  } catch {
    // git answered the repository probe but not this; leave it to the commit,
    // which reports its own failure without stopping setup.
    return;
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
      "Setup commits the files it writes so the first release records a commit, which it can only do " +
      "safely from a clean tree — otherwise your own work would be committed under setup's name. " +
      "Commit or stash what is listed, then run setup again. To set up without touching version " +
      "control at all, pass --no-git.",
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
  const existing = await insideRepository(cwd);
  try {
    if (!existing) {
      await git(cwd, ["init", "--quiet"]);
    }
    await git(cwd, ["add", "--all", "--", "."]);
    // `.gitignore` is the first line of defence and the scaffold writes one,
    // but a secret committed once cannot be scrubbed later, so the staged set
    // is checked rather than trusted.
    const staged = await stagedPaths(cwd);
    const secrets = staged.filter(isSecretPath);
    if (secrets.length > 0) {
      await git(cwd, ["reset", "--quiet", "--", ...secrets]);
    }
    // Unstaging is verified rather than assumed. `git reset` reports success
    // for a pathspec that matched nothing, so a path the index does not hold
    // under that spelling would leave the secret staged and silently commit it.
    const stillStaged = (await stagedPaths(cwd)).filter(isSecretPath);
    if (stillStaged.length > 0) {
      return {
        kind: "unavailable",
        reason: `${stillStaged[0]} could not be kept out of the commit, so nothing was committed`,
      };
    }
    if (staged.length === secrets.length) {
      return { kind: "unavailable", reason: "there was nothing to commit" };
    }
    const fallbackIdentity = !(await hasIdentity(cwd));
    const identity = fallbackIdentity
      ? ["-c", `user.name=${FALLBACK_IDENTITY.name}`, "-c", `user.email=${FALLBACK_IDENTITY.email}`]
      : [];
    // Signing is disabled for this commit alone: a configured GPG key would
    // otherwise block setup on a passphrase prompt it never asked for.
    await git(cwd, [
      ...identity,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      `--message=${INITIAL_COMMIT_SUBJECT}`,
    ]);
    return {
      kind: existing ? "committed" : "created",
      sha: (await git(cwd, ["rev-parse", "HEAD"])).trim(),
      fallbackIdentity,
    };
  } catch (error) {
    return { kind: "unavailable", reason: messageOf(error) };
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
