/**
 * A single filesystem mutation in a scaffold plan. Adapters emit these as a
 * declarative description of intended changes so the scaffolder can apply,
 * skip, or dry-run them uniformly. Each variant maps to one handler in the
 * scaffolder; the `kind` discriminant is exhaustively switched on.
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
 * The output of an adapter's planning phase: the ordered file operations to
 * apply plus a human-readable summary. Decoupling planning from execution lets
 * callers preview (dry-run), merge plans from multiple adapters, and report
 * intent before touching the disk.
 */
export type ScaffoldPlan = {
  ops: FileOp[];
  summary: { title: string; detail: string }[];
};

/**
 * The outcome of applying a {@link ScaffoldPlan}. Distinguishes files actually
 * written from those left unchanged (idempotent re-runs) so commands can report
 * an accurate, no-surprises summary, and tracks which dependencies were added.
 */
export type ScaffoldResult = {
  dryRun: boolean;
  filesWritten: string[];
  filesSkipped: string[];
  depsAdded: string[];
};
