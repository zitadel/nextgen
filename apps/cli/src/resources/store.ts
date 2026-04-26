import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ZitadelError } from "../lib/errors";
import { parseJsonObject, stableStringify } from "../lib/json";
import { RESOURCE_DIRECTORIES, type ResourceKind, isValidSlug } from "./types";

export async function listResources(
  cwd: string,
  kind: ResourceKind,
): Promise<Array<{ slug: string; path: string; contents: Record<string, unknown> }>> {
  const dir = join(cwd, RESOURCE_DIRECTORIES[kind]);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const results: Array<{ slug: string; path: string; contents: Record<string, unknown> }> = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const abs = join(dir, entry);
    const contents = parseJsonObject(await readFile(abs, "utf8"), abs);
    results.push({ slug: entry.replace(/\.json$/, ""), path: `${RESOURCE_DIRECTORIES[kind]}/${entry}`, contents });
  }
  return results;
}

export async function readResource(
  cwd: string,
  kind: ResourceKind,
  slug: string,
): Promise<{ path: string; contents: Record<string, unknown> } | undefined> {
  assertValidSlug(slug);
  const rel = `${RESOURCE_DIRECTORIES[kind]}/${slug}.json`;
  const abs = join(cwd, rel);
  try {
    return { path: rel, contents: parseJsonObject(await readFile(abs, "utf8"), abs) };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function writeResource(
  cwd: string,
  kind: ResourceKind,
  slug: string,
  contents: Record<string, unknown>,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<{ path: string; created: boolean }> {
  assertValidSlug(slug);
  const rel = `${RESOURCE_DIRECTORIES[kind]}/${slug}.json`;
  const abs = join(cwd, rel);
  const nextText = `${stableStringify(contents)}\n`;
  const existing = await readTextIfExists(abs);

  if (existing !== undefined && !opts.force && existing !== nextText) {
    throw new ZitadelError("E_CONFLICT", `Resource ${rel} already exists`, {
      hint: "Re-run with --force to overwrite, or remove it first with `zitadel " + kind + " remove " + slug + "`.",
      details: { path: rel },
    });
  }

  if (opts.dryRun) {
    return { path: rel, created: existing === undefined };
  }

  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, nextText);
  await rename(tmp, abs);
  return { path: rel, created: existing === undefined };
}

export async function removeResource(
  cwd: string,
  kind: ResourceKind,
  slug: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ path: string; removed: boolean }> {
  assertValidSlug(slug);
  const rel = `${RESOURCE_DIRECTORIES[kind]}/${slug}.json`;
  const abs = join(cwd, rel);
  const existing = await readTextIfExists(abs);
  if (existing === undefined) return { path: rel, removed: false };
  if (opts.dryRun) return { path: rel, removed: true };
  await rm(abs, { force: true });
  return { path: rel, removed: true };
}

function assertValidSlug(slug: string): void {
  if (!isValidSlug(slug)) {
    throw new ZitadelError("E_VALIDATION", `Invalid slug "${slug}"`, {
      hint: "Slugs must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (max 40 chars).",
    });
  }
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
