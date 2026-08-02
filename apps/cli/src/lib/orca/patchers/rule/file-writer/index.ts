import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ZitadelError } from "../../../../errors";
import {
  isObject,
  parseJsonObject,
  setTopLevelJsonKey,
  stableStringify,
} from "../../../../json";
import type { PatchedFile } from "../../types";
import type { FileOp, ScaffoldPlan, ScaffoldResult } from "./types";

/**
 * The executor's private, mutable accumulator. Handlers record each touched
 * artifact as a typed row; {@link scaffold} derives the readonly
 * {@link ScaffoldResult} from it so the public result stays immutable.
 */
type ScaffoldAccumulator = {
  dryRun: boolean;
  files: PatchedFile[];
  filesSkipped: string[];
  depsAdded: string[];
};

/**
 * Records one touched artifact, deduplicating by path: several plan ops can
 * legitimately hit the same file (the base and framework op lists both merge
 * into `.env.local`, for example), but the report should carry it once, with
 * the first action as the net one — a file created and then extended in the
 * same run was created by the run.
 */
function record(
  result: ScaffoldAccumulator,
  path: string,
  kind: PatchedFile["kind"],
  action: PatchedFile["action"],
): void {
  if (result.files.some((file) => file.path === path)) {
    return;
  }
  result.files.push({ path, kind, action });
}

/**
 * Applies a {@link ScaffoldPlan} to disk, executing its operations in order.
 *
 * Operations are idempotent: writes whose target already matches the desired
 * contents are recorded as skipped rather than rewritten, so re-running setup
 * is safe. With `dryRun` no filesystem changes are made but the result still
 * reflects what would have been written. Existing files are only overwritten
 * when `force` is set; otherwise an `E_CONFLICT` is thrown to protect
 * user-authored content. Paths in the plan are resolved relative to `cwd`.
 */
export async function scaffold(
  plan: ScaffoldPlan,
  opts: { cwd: string; dryRun: boolean; force: boolean },
): Promise<ScaffoldResult> {
  const result: ScaffoldAccumulator = {
    dryRun: opts.dryRun,
    files: [],
    filesSkipped: [],
    depsAdded: [],
  };

  for (const op of plan.ops) {
    await applyOp(op, opts, result);
  }

  const written = new Set(result.files.map((file) => file.path));
  return {
    dryRun: result.dryRun,
    files: result.files,
    // Legacy flat list: deduplicated file paths only. Directories stay in
    // `files` rows (kind "dir"); a path both written and later skipped as
    // already-matching reports as written.
    filesWritten: result.files.filter((file) => file.kind === "file").map((file) => file.path),
    filesSkipped: [...new Set(result.filesSkipped)].filter((path) => !written.has(path)),
    depsAdded: result.depsAdded,
  };
}

async function applyOp(
  op: FileOp,
  opts: { cwd: string; dryRun: boolean; force: boolean },
  result: ScaffoldAccumulator,
): Promise<void> {
  switch (op.kind) {
    case "mkdir":
      await ensureDir(abs(opts.cwd, op.path), op.mode, opts.dryRun, result);
      break;
    case "write":
      await writeText(
        abs(opts.cwd, op.path),
        op.contents,
        { mode: op.mode, force: opts.force, dryRun: opts.dryRun },
        result,
      );
      break;
    case "append":
      await appendText(abs(opts.cwd, op.path), op.contents, op.ifMissing, opts.dryRun, result);
      break;
    case "merge-env":
      await mergeEnv(abs(opts.cwd, op.path), op.entries, opts.dryRun, result);
      break;
    case "merge-json":
      await mergeJson(abs(opts.cwd, op.path), op.patch, opts.dryRun, result);
      break;
    case "append-gitignore":
      await appendGitignore(abs(opts.cwd, ".gitignore"), op.entries, opts.dryRun, result);
      break;
    case "add-dep":
      await addDependency(abs(opts.cwd, "package.json"), op, opts.dryRun, result);
      break;
    case "edit":
      await editFile(opts.cwd, op.path, op.edit, opts.dryRun, result);
      break;
  }
}

/**
 * Generic content edit: read the file, run the patcher-supplied transform, write
 * the result. Framework knowledge lives entirely in `edit` (next to its
 * patcher); this executor only owns candidate resolution, idempotency, dry-run,
 * and the atomic write. `pathOrPaths` may be a single path or a priority list of
 * candidates — the first that exists wins, else the first candidate.
 */
async function editFile(
  cwd: string,
  pathOrPaths: string | ReadonlyArray<string>,
  edit: (source: string | undefined) => string,
  dryRun: boolean,
  result: ScaffoldAccumulator,
): Promise<void> {
  const candidates = (typeof pathOrPaths === "string" ? [pathOrPaths] : pathOrPaths).map((p) =>
    abs(cwd, p),
  );
  if (candidates.length === 0) {
    throw new ZitadelError("E_VALIDATION", "An edit op needs at least one candidate path", {
      hint: "This is an internal patcher error — please report it if you hit it.",
    });
  }
  let path = candidates[0];
  let source: string | undefined;
  let mode: number | undefined;
  for (const candidate of candidates) {
    const contents = await readIfExists(candidate);
    if (contents !== undefined) {
      path = candidate;
      source = contents;
      // Preserve the existing file's permission bits across the temp-file swap
      // (mask off the file-type bits `stat` includes so `chmod` gets only perms).
      mode = (await stat(candidate)).mode & 0o777;
      break;
    }
  }
  const next = edit(source);
  if (next === source) {
    result.filesSkipped.push(path);
    return;
  }
  const action = source === undefined ? "create" : "update";
  if (dryRun) {
    record(result, path, "file", action);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, next);
  if (mode !== undefined) {
    await chmod(tmp, mode).catch(() => undefined);
  }
  await rename(tmp, path);
  record(result, path, "file", action);
}

async function ensureDir(
  path: string,
  mode: number | undefined,
  dryRun: boolean,
  result: ScaffoldAccumulator,
): Promise<void> {
  // An already-existing directory is a skip — unless its permissions drifted
  // from the requested mode, in which case the chmod below repairs them and
  // the report says so (an "update" row, not a silent skip). Windows does not
  // implement POSIX permission classes (only the write bit is changeable), so
  // there the mode comparison is meaningless and healing is never reported —
  // otherwise every rerun would flag `.zitadel` as an update forever.
  const pre = await stat(path).catch(() => undefined);
  const existed = pre?.isDirectory() ?? false;
  const healsMode =
    existed &&
    mode !== undefined &&
    process.platform !== "win32" &&
    (pre!.mode & 0o777) !== mode;
  if (dryRun) {
    if (!existed) {
      record(result, path, "dir", "create");
    } else if (healsMode) {
      record(result, path, "dir", "update");
    } else {
      result.filesSkipped.push(path);
    }
    return;
  }
  await mkdir(path, { recursive: true, mode });
  if (mode) {
    await chmod(path, mode).catch(() => undefined);
  }
  if (!existed) {
    record(result, path, "dir", "create");
  } else if (healsMode) {
    record(result, path, "dir", "update");
  } else {
    result.filesSkipped.push(path);
  }
}

async function writeText(
  path: string,
  contents: string,
  opts: { mode?: number; force: boolean; dryRun: boolean },
  result: ScaffoldAccumulator,
): Promise<void> {
  const existing = await readIfExists(path);
  if (existing === contents) {
    result.filesSkipped.push(path);
    return;
  }

  if (existing !== undefined && !opts.force) {
    throw new ZitadelError("E_CONFLICT", `Refusing to overwrite ${path}`, {
      hint: "Re-run with --force if you want the CLI to replace this file.",
      details: { path },
    });
  }

  const action = existing === undefined ? "create" : "update";
  if (opts.dryRun) {
    record(result, path, "file", action);
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, contents, { mode: opts.mode });
  if (opts.mode) {
    await chmod(tmp, opts.mode).catch(() => undefined);
  }
  await rename(tmp, path);
  record(result, path, "file", action);
}

async function appendText(
  path: string,
  contents: string,
  ifMissing: string | undefined,
  dryRun: boolean,
  result: ScaffoldAccumulator,
): Promise<void> {
  const raw = await readIfExists(path);
  const existing = raw ?? "";
  if (ifMissing && existing.includes(ifMissing)) {
    result.filesSkipped.push(path);
    return;
  }

  const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${contents}`;
  if (next === existing) {
    result.filesSkipped.push(path);
    return;
  }

  const action = raw === undefined ? "create" : "update";
  if (dryRun) {
    record(result, path, "file", action);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  record(result, path, "file", action);
}

async function mergeEnv(
  path: string,
  entries: Readonly<Record<string, string>>,
  dryRun: boolean,
  result: ScaffoldAccumulator,
): Promise<void> {
  const raw = await readIfExists(path);
  const existing = raw ?? "";
  const present = new Set(
    existing
      .split(/\r?\n/g)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter((value): value is string => Boolean(value)),
  );
  const additions = Object.entries(entries).filter(([key]) => !present.has(key));
  if (additions.length === 0) {
    result.filesSkipped.push(path);
    return;
  }

  const block = additions.map(([key, value]) => `${key}=${value}`).join("\n");
  const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${block}\n`;
  const action = raw === undefined ? "create" : "update";
  if (dryRun) {
    record(result, path, "file", action);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  record(result, path, "file", action);
}

async function mergeJson(
  path: string,
  patch: Readonly<Record<string, unknown>>,
  dryRun: boolean,
  result: ScaffoldAccumulator,
): Promise<void> {
  const existing = await readIfExists(path);
  const current = existing ? parseJsonObject(existing, path) : {};
  const next = deepMerge(current, patch);
  const contents = `${stableStringify(next)}\n`;
  if (existing === contents) {
    result.filesSkipped.push(path);
    return;
  }
  const action = existing === undefined ? "create" : "update";
  if (dryRun) {
    record(result, path, "file", action);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  record(result, path, "file", action);
}

async function appendGitignore(
  path: string,
  entries: ReadonlyArray<string>,
  dryRun: boolean,
  result: ScaffoldAccumulator,
): Promise<void> {
  const raw = await readIfExists(path);
  const existing = raw ?? "";
  const lines = new Set(existing.split(/\r?\n/g).map((line) => line.trim()));
  const missing = entries.filter((entry) => !lines.has(entry));
  if (missing.length === 0) {
    result.filesSkipped.push(path);
    return;
  }
  const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`;
  const action = raw === undefined ? "create" : "update";
  if (dryRun) {
    record(result, path, "file", action);
    return;
  }
  await writeFile(path, next);
  record(result, path, "file", action);
}

async function addDependency(
  path: string,
  op: { name: string; version: string; dev?: boolean },
  dryRun: boolean,
  result: ScaffoldAccumulator,
): Promise<void> {
  const existing = await readIfExists(path);
  if (!existing) {
    throw new ZitadelError("E_VALIDATION", "package.json is required to add Zitadel dependencies");
  }
  const current = parseJsonObject(existing, path);
  const key = op.dev ? "devDependencies" : "dependencies";
  const deps = isObject(current[key]) ? (current[key] as Record<string, unknown>) : {};
  if (deps[op.name] === op.version) {
    result.filesSkipped.push(path);
    return;
  }
  // package.json is user-owned: splice only the dependency map's value into
  // the document. Every byte outside it — key order, blank lines, inline
  // objects, line endings — stays untouched; the touched map itself is
  // name-sorted, matching what a package manager writes.
  const contents = setTopLevelJsonKey(
    existing,
    path,
    key,
    sortByKey({ ...deps, [op.name]: op.version }),
  );
  if (dryRun) {
    record(result, path, "file", "update");
    result.depsAdded.push(op.name);
    return;
  }
  await writeFile(path, contents);
  record(result, path, "file", "update");
  result.depsAdded.push(op.name);
}

/** Rebuilds an object with lexicographically sorted keys (dependency maps). */
function sortByKey(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function abs(cwd: string, path: string): string {
  return join(cwd, path);
}

function deepMerge(
  target: Record<string, unknown>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
