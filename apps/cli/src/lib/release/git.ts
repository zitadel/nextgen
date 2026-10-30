import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
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
 * The `git diff` options the terminal's diff and the `--json` one share, so
 * the two never disagree: git's own unified diff, never an external diff
 * program's, with paths relative to the project, as the CLI reports them
 * everywhere else.
 */
const DIFF_OPTIONS = ["--no-ext-diff", "--relative"];

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
  return diffConfig(cwd, sha, [color ? "--color=always" : "--no-color"], referenced);
}

/** One changed file of a deploy's diff, as `deploy --json` reports it. */
export interface ConfigDiffFile {
  /** Project-relative; for a rename or a copy, where the file is now. */
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed" | "copied";
  /** Where a renamed or copied file came from. */
  readonly previous_path?: string;
  /** The file's part of the diff, uncoloured, exactly as the terminal shows it. */
  readonly patch: string;
}

/**
 * {@link diffConfigAgainst}, uncoloured and split by file: joined back
 * together, the patches are the diff the terminal shows. Null when no diff can
 * be shown, for the same reasons.
 */
export async function diffConfigFilesAgainst(
  cwd: string,
  sha: string,
  referenced: readonly string[] = [],
): Promise<ConfigDiffFile[] | null> {
  // `--raw -z` lists every file's status and paths, unquoted, ahead of the patch.
  const output = await diffConfig(cwd, sha, ["--no-color", "--raw", "-z", "--patch"], referenced);
  return output === null ? null : splitByFile(output);
}

/**
 * Pair the `--raw -z` records with the patch's per-file sections. git writes
 * both from one list of files, in one order, so they line up one to one, except
 * for a file whose type changed (a file replaced by a symlink): git shows it as
 * a deletion and a creation, two sections under one header, joined here.
 */
function splitByFile(output: string): ConfigDiffFile[] {
  let at = 0;
  const field = (): string => {
    const end = output.indexOf("\0", at);
    const value = output.slice(at, end === -1 ? output.length : end);
    at = end === -1 ? output.length : end + 1;
    return value;
  };
  const records: Omit<ConfigDiffFile, "patch">[] = [];
  // A record is `:<modes> <ids> <status letter>[<score>]`, then its path, or
  // for a rename or a copy the path it came from and the path it went to.
  while (output.startsWith(":", at)) {
    const meta = field();
    const letter = meta.charAt(meta.lastIndexOf(" ") + 1);
    const path = field();
    if (letter === "R" || letter === "C") {
      const status = letter === "R" ? "renamed" : "copied";
      records.push({ path: field(), status, previous_path: path });
    } else {
      const status = letter === "A" ? "added" : letter === "D" ? "deleted" : "modified";
      records.push({ path, status });
    }
  }

  // One more NUL ends the records; the patch follows.
  const sections = output.slice(at + 1).split(/^(?=diff --git )/m);
  let next = 0;
  return records.map((record) => {
    let patch = sections[next++] ?? "";
    while (next < sections.length && headerOf(sections[next]) === headerOf(patch)) {
      patch += sections[next++];
    }
    return { ...record, patch };
  });
}

/** A patch section's first line, its `diff --git` header. */
function headerOf(section = ""): string {
  const end = section.indexOf("\n");
  return end === -1 ? section : section.slice(0, end);
}

/** `git diff` of the release's paths against `sha`, in `format`. */
async function diffConfig(
  cwd: string,
  sha: string,
  format: readonly string[],
  referenced: readonly string[],
): Promise<string | null> {
  const paths = [...CONFIG_PATHS, ...referenced];
  const resolved = await git(cwd, ["cat-file", "-e", `${sha}^{commit}`]);
  if (resolved === null) {
    return null;
  }
  const diffArgs = ["diff", ...DIFF_OPTIONS, ...format, sha, "--", ...paths];

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
    // Git uses the index's mtime to detect same-size edits made within one
    // timestamp tick. A fresh copy's newer mtime would hide those changes.
    // Round down to milliseconds so conversion never makes the copy newer.
    try {
      const sourceIndex = resolve(cwd, indexPath);
      const { atime, mtimeMs } = await stat(sourceIndex);
      await copyFile(sourceIndex, tempIndex);
      await utimes(tempIndex, atime, Math.floor(mtimeMs) / 1000);
    } catch (error) {
      // A fresh repo has no index yet; other failures use the original index.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return git(cwd, diffArgs);
      }
    }
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
