/**
 * A single filesystem mutation in a rule-based patcher's plan. Rule patchers
 * emit these as a declarative description of intended changes so the
 * {@link import("./index").scaffold} file-writer can apply, skip, or dry-run
 * them uniformly. Each variant maps to one handler in the file-writer; the
 * `kind` discriminant is exhaustively switched on. This vocabulary is internal
 * to the rule patcher family — other patcher families need not produce it.
 */
export type FileOp =
  | { readonly kind: "mkdir"; readonly path: string; readonly mode?: number }
  | { readonly kind: "write"; readonly path: string; readonly mode?: number; readonly contents: string }
  | {
      readonly kind: "append";
      readonly path: string;
      readonly contents: string;
      readonly ifMissing?: string;
    }
  | {
      readonly kind: "merge-env";
      readonly path: string;
      readonly entries: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "merge-json";
      readonly path: string;
      readonly patch: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "append-gitignore"; readonly entries: ReadonlyArray<string> }
  | { readonly kind: "add-dep"; readonly name: string; readonly version: string; readonly dev?: boolean };

/**
 * A rule-based patcher's plan: the ordered file operations to apply plus a
 * human-readable summary. Decoupling planning from execution lets the patcher
 * preview (dry-run), compose ops from base files and framework routes, and
 * report intent before touching the disk.
 */
export type ScaffoldPlan = {
  ops: ReadonlyArray<FileOp>;
  summary: ReadonlyArray<{ title: string; detail: string }>;
};

/**
 * The outcome of applying a {@link ScaffoldPlan}. Distinguishes files actually
 * written from those left unchanged (idempotent re-runs) and tracks added
 * dependencies. Structurally compatible with the family-neutral `PatchResult`
 * the patcher returns to callers.
 */
export type ScaffoldResult = {
  dryRun: boolean;
  filesWritten: ReadonlyArray<string>;
  filesSkipped: ReadonlyArray<string>;
  depsAdded: ReadonlyArray<string>;
};
