import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** `.zitadel/` relative to the repo root, the only path a deploy diffs. */
const CONFIG_PATH = ".zitadel/";

/** Run git in `cwd`, returning its stdout, or null when git cannot answer. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
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

/** Whether the working tree has uncommitted changes under `.zitadel/`. */
export async function configIsDirty(cwd: string): Promise<boolean> {
  const stdout = await git(cwd, ["status", "--porcelain", "--", CONFIG_PATH]);
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
  return git(cwd, ["diff", color ? "--color=always" : "--no-color", sha, "--", CONFIG_PATH]);
}
