import { type DiffedFile, Repository } from "../git";

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

/** The current commit, or null when there is no repo or no commit yet. */
export async function headSha(cwd: string): Promise<string | null> {
  return quietly(async () => (await Repository.open(cwd))?.currentCommit() ?? null, null);
}

/**
 * Whether the repository's working tree has any uncommitted change, anywhere —
 * not only under `.zitadel/`. A release records the provenance of the whole
 * commit it was built from, so a change outside `.zitadel/` (a code change that
 * the config depends on, say) makes that provenance just as inexact.
 */
export async function worktreeIsDirty(cwd: string): Promise<boolean> {
  return quietly(async () => (await Repository.open(cwd))?.isDirty() ?? false, false);
}

/**
 * The coloured diff of `.zitadel/` against `sha`, or null when no diff can be
 * shown: git is missing, this is not a repo, or the commit is not in local
 * history (a shallow clone, say).
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
  return quietly(
    async () => (await Repository.open(cwd))?.diffSince(sha, paths, { color }) ?? null,
    null,
  );
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
): Promise<DiffedFile[] | null> {
  const paths = [...CONFIG_PATHS, ...referenced];
  return quietly(
    async () => (await Repository.open(cwd))?.diffFilesSince(sha, paths) ?? null,
    null,
  );
}

/** What `read` returns, or `fallback` when git fails: a release records what git can tell, no more. */
async function quietly<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}
