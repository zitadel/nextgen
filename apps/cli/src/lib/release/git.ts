import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The directories a release is built from, the only paths a deploy diffs. Not
 * the whole of `.zitadel/`: `state.json` and `meta/` are not published, and
 * `.zitadel/secret` or `.zitadel/local/`, left untracked but not ignored, would
 * otherwise be marked for the diff and their contents printed.
 */
const CONFIG_PATHS = [
  ".zitadel/schemas/",
  ".zitadel/flows/",
  ".zitadel/branding/",
  ".zitadel/idps/",
];

/** Run git in `cwd`, returning its stdout, or null when git cannot answer. */
async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return stdout;
  } catch {
    // git missing, not a repo, or the command failed — the caller decides what
    // that means for it.
    return null;
  }
}

/** The current commit, or null when there is no repo or no commit yet. */
export async function headSha(cwd: string): Promise<string | null> {
  const stdout = await git(cwd, ["rev-parse", "HEAD"]);
  return stdout === null ? null : stdout.trim() || null;
}

/**
 * Whether the repository's working tree has any uncommitted change, anywhere —
 * not only under `.zitadel/`. A release records the provenance of the whole
 * commit it was built from, so a change outside `.zitadel/` (a code change that
 * the config depends on, say) makes that provenance just as inexact.
 */
export async function worktreeIsDirty(cwd: string): Promise<boolean> {
  const stdout = await git(cwd, ["status", "--porcelain"]);
  return stdout !== null && stdout.trim() !== "";
}

/**
 * The coloured diff of `.zitadel/` against `sha`, or null when no diff can be
 * shown: git is missing, this is not a repo, or the commit is not in local
 * history (a shallow clone, say). A dead commit is told apart from a clean tree
 * by first checking the commit resolves.
 */
export async function diffConfigAgainst(
  cwd: string,
  sha: string,
  color: boolean,
  /**
   * Project-relative files the bundle inlines from outside {@link CONFIG_PATHS}
   * — a branding descriptor's `$file` template may sit anywhere in the project.
   * Editing only that file changes what a deploy publishes, so it diffs too.
   */
  referenced: readonly string[] = [],
): Promise<string | null> {
  const paths = [...CONFIG_PATHS, ...referenced];
  const resolved = await git(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
  if (resolved === null) {
    return null;
  }
  const diffArgs = ["diff", color ? "--color=always" : "--no-color", sha, "--", ...paths];

  // `git diff` omits untracked files, but a release bundle includes every new
  // file under `.zitadel/`, so a brand-new (untracked) resource must show in
  // the diff too. We mark the untracked files intent-to-add (`git add -N`) in a
  // throwaway copy of the index, selected with GIT_INDEX_FILE, so they diff as
  // additions — without touching the real index another process in this
  // worktree may be using. If anything in that setup fails we fall back to the
  // plain diff, which still shows every tracked change.
  const indexPath = (await git(cwd, ["rev-parse", "--git-path", "index"]))?.trim();
  if (!indexPath) {
    return git(cwd, diffArgs);
  }
  let scratch: string | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), "zitadel-diff-"));
    const tempIndex = join(scratch, "index");
    // The real index may not exist yet (a fresh repo); start empty if so.
    await copyFile(resolve(cwd, indexPath), tempIndex).catch(() => undefined);
    const env: NodeJS.ProcessEnv = { GIT_INDEX_FILE: tempIndex };
    // `git add` refuses a whole pathspec when one part matches nothing, so only
    // the directories this project has are marked.
    const present = paths.filter((path) => existsSync(join(cwd, path)));
    if (present.length > 0) {
      await git(cwd, ["add", "-N", "--", ...present], env);
    }
    // Fall back to the plain diff if the scratch-index diff could not run, so a
    // resolvable commit never reports "no diff available" by mistake.
    return (await git(cwd, diffArgs, env)) ?? (await git(cwd, diffArgs));
  } finally {
    if (scratch) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
