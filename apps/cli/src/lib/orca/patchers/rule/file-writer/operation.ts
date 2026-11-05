import { ZitadelError } from "@/lib/errors";
import type { FileOp } from "./types";
import type { Entry, Workspace } from "./workspace";

/**
 * One kind of {@link FileOp}, so an op takes exactly the shape it handles.
 */
export type OpOf<Kind extends FileOp["kind"]> = Extract<FileOp, { kind: Kind }>;

/**
 * What an op sees of the path it acts on.
 */
export type Source = Readonly<{
  /** The first candidate path that exists, or the first candidate when none does. */
  path: string;
  /** What the file holds, or `undefined` when there is none. */
  before: string | undefined;
  /** What the file holds, or an empty string when there is none. */
  text: string;
  /** What is at the path, or `undefined` when nothing is. */
  entry: Entry | undefined;
  /** Whether the run may replace files it did not write. */
  force: boolean;
}>;

/**
 * How a file is to be written, and what writing it adds, beyond what it holds.
 */
export type Extras = Readonly<{
  /** Permission bits to set on what is written. */
  mode?: number;
  /** Write to a temporary file and rename it over the target, so a reader never sees half a file. */
  atomic?: boolean;
  /** Set `mode` on an existing file that needs no change, so a secret does not stay at a looser mode. */
  reassertMode?: boolean;
  /** The dependency the change adds, reported when the change is made or, on a dry run, previewed. */
  dependency?: string;
}>;

/**
 * A change to one file: what it holds now, what it should hold, and how to
 * write it.
 */
export type FileChange = Readonly<
  Extras & {
    kind: "file";
    path: string;
    /** What the file holds now, or `undefined` when it does not exist. */
    before: string | undefined;
    /** What it should hold. */
    next: string;
  }
>;

/**
 * A change to one directory: whether it exists, and whether its permissions
 * have drifted from `mode`.
 */
export type DirChange = Readonly<{
  kind: "dir";
  path: string;
  mode?: number;
  isExisting: boolean;
  isDrifted: boolean;
}>;

/**
 * What an op asks of the disk.
 */
export type Change = FileChange | DirChange;

/**
 * One op of a plan.
 *
 * Every op says the same two things: which paths it may act on
 * ({@link Operation.target}), and what it asks of the disk once it has seen
 * what is there ({@link Operation.change}). This class finds the path, looks at
 * it, and hands the result over, so an op is only those two methods.
 */
export abstract class Operation<Kind extends FileOp["kind"]> {
  protected readonly op: OpOf<Kind>;

  /**
   * @param op - What the plan asks for.
   */
  constructor(op: OpOf<Kind>) {
    this.op = op;

    Object.freeze(this);
  }

  /**
   * @param workspace - Where the plan is applied.
   * @returns What this op asks of the disk.
   * @throws `E_VALIDATION` when the op names no path, or, unless it makes a
   * directory, names something that is not a regular file.
   */
  async plan(workspace: Workspace): Promise<Change> {
    const candidates = this.target().map((path) => {
      return workspace.resolve(path);
    });
    const [preferred] = candidates;
    const located = await workspace.locate(candidates);

    if (preferred === undefined) {
      throw new ZitadelError("E_VALIDATION", "An op needs at least one candidate path", {
        hint: "This is an internal patcher error — please report it if you hit it.",
      });
    }

    const path = located?.path ?? preferred;
    const isDirectoryOp = this.op.kind === "mkdir";
    const isClash = !isDirectoryOp && located !== undefined && !located.entry.isFile;

    if (isClash) {
      throw new ZitadelError("E_VALIDATION", `${path} is not a regular file`);
    }

    const before = !isDirectoryOp && located !== undefined ? await workspace.read(path) : undefined;

    return this.change({
      path,
      before,
      text: before ?? "",
      entry: located?.entry,
      force: workspace.force,
    });
  }

  /**
   * @returns The paths this op may act on, relative to the workspace, the preferred one first.
   */
  protected abstract target(): ReadonlyArray<string>;

  /**
   * @param source - What is at the path now.
   * @returns What this op asks of the disk.
   */
  protected abstract change(source: Source): Change;

  /**
   * @param existing - What a file holds.
   * @param block - What to add after it.
   * @returns `existing` followed by `block`, on a line of its own.
   */
  protected joined(existing: string, block: string): string {
    const gap = existing && !existing.endsWith("\n") ? "\n" : "";

    return `${existing}${gap}${block}`;
  }

  /**
   * @param source - What is at the path now.
   * @param next - What the file should hold.
   * @param extras - How the file is to be written, beyond what it holds.
   * @returns The change that brings the file to `next`.
   */
  protected file(source: Source, next: string, extras: Extras = {}): Change {
    return {
      kind: "file",
      path: source.path,
      before: source.before,
      next,
      ...extras,
    };
  }

  /**
   * @param source - What is at the path now.
   * @param state - The directory's permissions, and whether it exists and has drifted from them.
   * @returns The change that brings the directory to `state`.
   */
  protected dir(
    source: Source,
    state: Readonly<{ mode?: number; isExisting: boolean; isDrifted: boolean }>,
  ): Change {
    return {
      kind: "dir",
      path: source.path,
      ...state,
    };
  }
}
