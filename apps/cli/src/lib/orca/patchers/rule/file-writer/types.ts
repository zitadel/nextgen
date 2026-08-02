import type { PatchedFile } from "../../types";

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
  | {
      readonly kind: "add-dep";
      readonly name: string;
      readonly version: string;
      readonly dev?: boolean;
    }
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
       *
       * `overwrites` marks a transform that replaces the file wholesale instead
       * of merging into it (its output ignores `source`, e.g. the scaffolded
       * framework home page). A missing-only repair may replay such an edit only
       * when no candidate exists; merging edits stay replayable because a
       * transform whose output equals the input is skipped.
       */
      readonly kind: "edit";
      readonly path: string | ReadonlyArray<string>;
      readonly edit: (source: string | undefined) => string;
      readonly overwrites?: true;
      /**
       * Marks a merging edit as managed *wiring* the doctor managed-files
       * check verifies via the transform's idempotency: when running the
       * transform against the current file changes it, the wiring is absent.
       * `infrastructure` wirings (dev proxy merges, route registrations) fail
       * the check when detached; `convenience` (the Angular `dev` script)
       * only warns. Unlabelled edits (guidance sections, the overwriting
       * home page) are not probed.
       */
      readonly wiring?: "infrastructure" | "convenience";
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
 * the patcher returns to callers: `files` carries the typed rows, and the
 * legacy `filesWritten` list holds deduplicated file paths only.
 */
export type ScaffoldResult = {
  dryRun: boolean;
  files: ReadonlyArray<PatchedFile>;
  filesWritten: ReadonlyArray<string>;
  filesSkipped: ReadonlyArray<string>;
  depsAdded: ReadonlyArray<string>;
};
