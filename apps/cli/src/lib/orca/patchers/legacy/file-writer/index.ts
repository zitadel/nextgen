import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ZitadelError } from "../../../../errors";
import { parseJsonObject, stableStringify } from "../../../../json";
import type { FileOp, ScaffoldPlan, ScaffoldResult } from "./plan";

/**
 * Executes a scaffold plan against the filesystem, applying each operation
 * in sequence and respecting dry-run mode throughout.
 */
export async function scaffold(
  plan: ScaffoldPlan,
  opts: { cwd: string; dryRun: boolean; force: boolean },
): Promise<ScaffoldResult> {
  const result: ScaffoldResult = {
    dryRun: opts.dryRun,
    filesWritten: [],
    filesSkipped: [],
    depsAdded: [],
  };

  for (const op of plan.ops) {
    await applyOp(op, opts, result);
  }

  return result;
}

async function applyOp(
  op: FileOp,
  opts: { cwd: string; dryRun: boolean; force: boolean },
  result: ScaffoldResult,
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
  }
}

async function ensureDir(
  path: string,
  mode: number | undefined,
  dryRun: boolean,
  result: ScaffoldResult,
): Promise<void> {
  if (dryRun) {
    result.filesWritten.push(path);
    return;
  }
  await mkdir(path, { recursive: true, mode });
  if (mode) {
    await chmod(path, mode).catch(() => undefined);
  }
  result.filesWritten.push(path);
}

async function writeText(
  path: string,
  contents: string,
  opts: { mode?: number; force: boolean; dryRun: boolean },
  result: ScaffoldResult,
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

  if (opts.dryRun) {
    result.filesWritten.push(path);
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, contents, { mode: opts.mode });
  if (opts.mode) {
    await chmod(tmp, opts.mode).catch(() => undefined);
  }
  await rename(tmp, path);
  result.filesWritten.push(path);
}

async function appendText(
  path: string,
  contents: string,
  ifMissing: string | undefined,
  dryRun: boolean,
  result: ScaffoldResult,
): Promise<void> {
  const existing = (await readIfExists(path)) ?? "";
  if (ifMissing && existing.includes(ifMissing)) {
    result.filesSkipped.push(path);
    return;
  }

  const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${contents}`;
  if (next === existing) {
    result.filesSkipped.push(path);
    return;
  }

  if (dryRun) {
    result.filesWritten.push(path);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  result.filesWritten.push(path);
}

async function mergeEnv(
  path: string,
  entries: Record<string, string>,
  dryRun: boolean,
  result: ScaffoldResult,
): Promise<void> {
  const existing = (await readIfExists(path)) ?? "";
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
  if (dryRun) {
    result.filesWritten.push(path);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  result.filesWritten.push(path);
}

async function mergeJson(
  path: string,
  patch: Record<string, unknown>,
  dryRun: boolean,
  result: ScaffoldResult,
): Promise<void> {
  const existing = await readIfExists(path);
  const current = existing ? parseJsonObject(existing, path) : {};
  const next = deepMerge(current, patch);
  const contents = `${stableStringify(next)}\n`;
  if (existing === contents) {
    result.filesSkipped.push(path);
    return;
  }
  if (dryRun) {
    result.filesWritten.push(path);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  result.filesWritten.push(path);
}

async function appendGitignore(
  path: string,
  entries: string[],
  dryRun: boolean,
  result: ScaffoldResult,
): Promise<void> {
  const existing = (await readIfExists(path)) ?? "";
  const lines = new Set(existing.split(/\r?\n/g).map((line) => line.trim()));
  const missing = entries.filter((entry) => !lines.has(entry));
  if (missing.length === 0) {
    result.filesSkipped.push(path);
    return;
  }
  const next = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`;
  if (dryRun) {
    result.filesWritten.push(path);
    return;
  }
  await writeFile(path, next);
  result.filesWritten.push(path);
}

async function addDependency(
  path: string,
  op: { name: string; version: string; dev?: boolean },
  dryRun: boolean,
  result: ScaffoldResult,
): Promise<void> {
  const existing = await readIfExists(path);
  if (!existing) {
    throw new ZitadelError("E_VALIDATION", "package.json is required to add Zitadel dependencies");
  }
  const current = parseJsonObject(existing, path);
  const key = op.dev === true ? "devDependencies" : "dependencies";
  const deps = isObject(current[key]) ? (current[key] as Record<string, unknown>) : {};
  if (deps[op.name] === op.version) {
    result.filesSkipped.push(path);
    return;
  }
  current[key] = { ...deps, [op.name]: op.version };
  const contents = `${stableStringify(current)}\n`;
  if (dryRun) {
    result.filesWritten.push(path);
    result.depsAdded.push(op.name);
    return;
  }
  await writeFile(path, contents);
  result.filesWritten.push(path);
  result.depsAdded.push(op.name);
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
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
  patch: Record<string, unknown>,
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
