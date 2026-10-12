import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** `.zitadel/` relative to the repo root, the only path a deploy diffs. */
const CONFIG_PATH = ".zitadel/";

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
): Promise<string | null> {
  const resolved = await git(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
  if (resolved === null) {
    return null;
  }
  const diffArgs = ["diff", color ? "--color=always" : "--no-color", sha, "--", CONFIG_PATH];

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
    await git(cwd, ["add", "-N", "--", CONFIG_PATH], env);
    // Fall back to the plain diff if the scratch-index diff could not run, so a
    // resolvable commit never reports "no diff available" by mistake.
    return (await git(cwd, diffArgs, env)) ?? (await git(cwd, diffArgs));
  } finally {
    if (scratch) {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
