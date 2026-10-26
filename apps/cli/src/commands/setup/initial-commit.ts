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
 * Identity used only when the machine has none configured. A commit cannot be
 * made without one, and refusing to commit would leave the first release
 * without a `git_sha` — the whole reason the commit exists.
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
  | { readonly kind: "created"; readonly sha: string }
  /** The project was already in a repository, and was committed into it. */
  | { readonly kind: "committed"; readonly sha: string }
  /** `--no-git`, or a dry run. */
  | { readonly kind: "skipped" }
  /** git is missing, or init/add/commit failed. */
  | { readonly kind: "unavailable"; readonly reason: string };

/** One entry of `git status --porcelain`, split into what it means. */
type Change = { readonly path: string; readonly untracked: boolean };

/**
 * Paths the CLI writes itself, which therefore do not count as the
 * developer's uncommitted work.
 *
 * `start` appends `.zitadel/local/` to `.gitignore` and writes the runtime
 * files under it, and it runs immediately before `setup` on the documented
 * golden path. Counting those would make setup refuse every project that has
 * ever been started, which is every project.
 */
function isCliOwned(path: string): boolean {
  return path === ".gitignore" || path === ".zitadel" || path.startsWith(".zitadel/");
}

/** Run git in `cwd`; throws with git's own stderr when it fails. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
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

/** Whether git has an author identity it can commit with. */
async function hasIdentity(cwd: string): Promise<boolean> {
  try {
    const email = (await git(cwd, ["config", "--get=user.email"])).trim();
    const name = (await git(cwd, ["config", "--get=user.name"])).trim();
    return email !== "" && name !== "";
  } catch {
    return false;
  }
}

/**
 * Everything git considers a change in `cwd`, untracked files included. An
 * untracked file counts: setup stages the whole tree, so one left lying about
 * would be swept into setup's commit, which is exactly what must not happen.
 */
async function changes(cwd: string): Promise<Change[]> {
  const stdout = await git(cwd, ["status", "--porcelain"]);
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => ({
      // Porcelain v1 is `XY <path>`: the status is the first two columns and
      // the path starts at the fourth, so a path with spaces survives intact.
      path: line.slice(3).trim(),
      untracked: line.slice(0, 2) === "??",
    }));
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
    dirty = (await changes(cwd)).filter((change) => !isCliOwned(change.path));
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
 * it stands, never nested inside. Either way the commit covers the whole tree,
 * which is safe because {@link assertCleanWorktree} has already refused a
 * repository with anything uncommitted: everything there is to commit by this
 * point is what setup itself wrote.
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
    const staged = (await git(cwd, ["diff", "--cached", "--name-only"]))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const secrets = staged.filter(isSecretPath);
    if (secrets.length > 0) {
      await git(cwd, ["reset", "--quiet", "--", ...secrets]);
    }
    if (staged.length === secrets.length) {
      return { kind: "unavailable", reason: "there was nothing to commit" };
    }
    const identity = (await hasIdentity(cwd))
      ? []
      : [
          "-c",
          `user.name=${FALLBACK_IDENTITY.name}`,
          "-c",
          `user.email=${FALLBACK_IDENTITY.email}`,
        ];
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
    };
  } catch (error) {
    return { kind: "unavailable", reason: messageOf(error) };
  }
}

/** git's own stderr where it has one, so the warning names the real cause. */
function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim() !== "") {
    return stderr.trim().split("\n")[0] ?? stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
