import { type DiffedFile, Repository } from "@/lib/git";
import { CONFIG_DIRECTORIES, RELEASE_POLICY_GLOBS } from "@/lib/zitadel";

/**
 * The directories a release is built from, the only paths a deploy diffs.
 *
 * @remarks
 * Not the whole of `.zitadel/`: `state.json` and `meta/` are not published,
 * and `.zitadel/secret` or `.zitadel/local/`, left untracked but not ignored,
 * would otherwise be marked for the diff and their contents printed. The
 * policies are diffed by {@link CONFIG_GLOBS} instead of by directory.
 */
const CONFIG_PATHS = [
  `${CONFIG_DIRECTORIES.schemas}/`,
  `${CONFIG_DIRECTORIES.flows}/`,
  `${CONFIG_DIRECTORIES.branding}/`,
  `${CONFIG_DIRECTORIES.connections}/`,
] as const;

/**
 * The policy files, as the bundle reads them rather than the whole directory,
 * so its `README.md` and anything in a subdirectory, which no release carries,
 * do not show as changes.
 */
const CONFIG_GLOBS = [RELEASE_POLICY_GLOBS.included];

/**
 * Policy test files sit beside the policies, but `policies test` runs them and
 * no release carries them.
 */
const EXCLUDED = [RELEASE_POLICY_GLOBS.excluded];

/**
 * The current commit.
 *
 * @param cwd - The project root.
 * @returns The commit's sha, or null when there is no repo or no commit yet.
 */
export async function headSha(cwd: string): Promise<string | null> {
  return Repository.answer(
    cwd,
    (repository) => {
      return repository.currentCommit();
    },
    null,
  );
}

/**
 * The current commit's subject line.
 *
 * @param cwd - The project root.
 * @returns The subject, or null when there is no repo or no commit yet.
 */
export async function headSubject(cwd: string): Promise<string | null> {
  return Repository.answer(
    cwd,
    (repository) => {
      return repository.currentSubject();
    },
    null,
  );
}

/**
 * Whether the repository's working tree has any uncommitted change, anywhere —
 * not only under `.zitadel/`.
 *
 * @remarks
 * A release records the provenance of the whole commit it was built from, so a
 * change outside `.zitadel/` (a code change that the config depends on, say)
 * makes that provenance just as inexact.
 *
 * @param cwd - The project root.
 * @returns Whether anything is uncommitted; false when there is no repo.
 */
export async function worktreeIsDirty(cwd: string): Promise<boolean> {
  return Repository.answer(
    cwd,
    (repository) => {
      return repository.isDirty();
    },
    false,
  );
}

/**
 * Whether anything under `.zitadel/` is uncommitted, untracked files included:
 * what a commit of the configuration would stage.
 *
 * @remarks
 * {@link worktreeIsDirty} is wider, and says nothing about whether such a
 * commit would have anything in it.
 *
 * @param cwd - The project root.
 * @returns Whether anything under `.zitadel/` is uncommitted; false when there
 *   is no repo.
 */
export async function configIsDirty(cwd: string): Promise<boolean> {
  const files = await Repository.answer(
    cwd,
    (repository) => {
      return repository.uncommittedFiles();
    },
    [],
  );
  return files.some((file) => {
    return file.path.startsWith(".zitadel/");
  });
}

/**
 * The coloured diff of `.zitadel/` against `sha`.
 *
 * @param cwd - The project root.
 * @param sha - The commit to diff against.
 * @param color - Whether the diff is coloured.
 * @param referenced - Project-relative files the bundle inlines from outside
 *   {@link CONFIG_PATHS} — a branding descriptor's `$file` template may sit
 *   anywhere in the project. Editing only that file changes what a deploy
 *   publishes, so it diffs too.
 * @returns The diff, or null when no diff can be shown: git is missing, this
 *   is not a repo, or the commit is not in local history (a shallow clone, say).
 */
export async function diffConfigAgainst(
  cwd: string,
  sha: string,
  color: boolean,
  referenced: readonly string[] = [],
): Promise<string | null> {
  const paths = [...CONFIG_PATHS, ...referenced];
  return Repository.answer(
    cwd,
    (repository) => {
      return repository.diffSince(sha, paths, { color, globs: CONFIG_GLOBS, excluded: EXCLUDED });
    },
    null,
  );
}

/**
 * {@link diffConfigAgainst}, uncoloured and split by file: joined back
 * together, the patches are the diff the terminal shows.
 *
 * @param cwd - The project root.
 * @param sha - The commit to diff against.
 * @param referenced - Project-relative files the bundle inlines from outside
 *   the configuration's directories.
 * @returns The patches, or null when no diff can be shown, for the same
 *   reasons.
 */
export async function diffConfigFilesAgainst(
  cwd: string,
  sha: string,
  referenced: readonly string[] = [],
): Promise<readonly DiffedFile[] | null> {
  const paths = [...CONFIG_PATHS, ...referenced];
  return Repository.answer(
    cwd,
    (repository) => {
      return repository.diffFilesSince(sha, paths, { globs: CONFIG_GLOBS, excluded: EXCLUDED });
    },
    null,
  );
}
