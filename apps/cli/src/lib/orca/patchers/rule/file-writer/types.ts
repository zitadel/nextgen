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
  | {
      readonly kind: "write";
      readonly path: string;
      readonly mode?: number;
      readonly contents: string;
      /**
       * Replace the file even if it already exists with different contents,
       * without requiring `--force`. Set only for managed files the integration
       * legitimately owns (e.g. an SPA's `src/App.tsx` auth entry, which is
       * framework boilerplate). Omitted writes still refuse to clobber existing
       * user files. The file still carries the managed marker so eject/doctor
       * stay marker-aware.
       */
      readonly overwrite?: boolean;
    }
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
  | { readonly kind: "add-dep"; readonly name: string; readonly version: string; readonly dev?: boolean }
  | {
      /**
       * Generic content edit. The file-writer reads the file (passing `undefined`
       * when it is absent), runs the patcher-supplied {@link edit} transform, and
       * writes the result — staying framework-agnostic. The transform owns ALL
       * framework knowledge (e.g. a magicast merge into `vite.config.ts`, or a
       * structured edit of `angular.json`) and lives next to its patcher. It must
       * be pure (no I/O) and may throw a `ZitadelError` when it cannot proceed.
       * Idempotent: a transform whose output equals the input is skipped.
       *
       * `path` may be a single path or a priority list of candidate paths (e.g.
       * the `vite.config.{ts,mts,js,…}` variants) — the executor edits the first
       * one that exists, falling back to the first candidate when none do. The
       * candidate list itself is generic; which paths to try is the patcher's call.
       */
      readonly kind: "edit";
      readonly path: string | ReadonlyArray<string>;
      readonly edit: (source: string | undefined) => string;
    };

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
