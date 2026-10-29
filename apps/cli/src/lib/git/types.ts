/** A test for paths to leave out, given a path relative to the directory. */
export type PathFilter = (path: string) => boolean;

/** Who to name as author where git has no identity of its own. */
export interface Author {
  readonly name: string;
  readonly email: string;
}

/** Whose name is on a commit: the developer's, one git guessed for them, or the fallback. */
export type AuthorSource = "yours" | "guessed" | "fallback";

/** How {@link Repository.commitAll} commits. */
export interface CommitOptions {
  /** Files never committed, whatever `.gitignore` says. */
  readonly except: PathFilter;
  /** The author used only where git can build no identity at all, as on a bare CI runner. */
  readonly authorIfGitHasNone: Author;
}

/** What {@link Repository.commitAll} did. */
export type CommitOutcome =
  /** Committed; `author` says whose name is on it. */
  | { readonly committed: true; readonly sha: string; readonly author: AuthorSource }
  /** Nothing was committed, for `reason`. */
  | { readonly committed: false; readonly reason: string };

/** How a diff is taken. */
export interface DiffOptions {
  /** Files never shown, not even their name: their content must not be printed. */
  readonly except: PathFilter;
}

/** How a diff for a terminal is taken. */
export interface ColoredDiffOptions extends DiffOptions {
  /** Colour the diff. */
  readonly color?: boolean;
}

/** A file with uncommitted changes. */
export interface UncommittedFile {
  /** Relative to the directory the repository was opened on. */
  readonly path: string;
  /** Whether git does not track it yet. */
  readonly untracked: boolean;
}

/** One changed file of a diff. */
export interface DiffedFile {
  /** Relative to the directory; for a rename or a copy, where the file is now. */
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed" | "copied";
  /** Where a renamed or copied file came from. */
  readonly previous_path?: string;
  /** This file's part of the diff. */
  readonly patch: string;
}
