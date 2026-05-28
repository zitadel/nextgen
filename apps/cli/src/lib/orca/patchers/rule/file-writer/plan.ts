/**
 * A single filesystem mutation in a rule-based patcher's plan. Rule patchers
 * emit these as a declarative description of intended changes so the
 * {@link import("./index").scaffold} file-writer can apply, skip, or dry-run
 * them uniformly. Each variant maps to one handler in the file-writer; the
 * `kind` discriminant is exhaustively switched on. This vocabulary is internal
 * to the rule patcher family — other patcher families need not produce it.
 */
export type FileOp =
  | { kind: "mkdir"; path: string; mode?: number }
  | { kind: "write"; path: string; mode?: number; contents: string }
  | { kind: "append"; path: string; contents: string; ifMissing?: string }
  | { kind: "merge-env"; path: string; entries: Record<string, string> }
  | { kind: "merge-json"; path: string; patch: Record<string, unknown> }
  | { kind: "append-gitignore"; entries: string[] }
  | { kind: "add-dep"; name: string; version: string; dev?: boolean };

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
