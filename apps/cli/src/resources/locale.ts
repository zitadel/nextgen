import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { ZitadelError } from "../lib/errors";
import { parseJsonObject, stableStringify } from "../lib/json";

export const LOCALES_DIR = ".zitadel/locales";
export const DEFAULT_LOCALE = "en";

export const localeSchema = z.record(z.string());
export type Locale = z.infer<typeof localeSchema>;

export function isValidLang(value: string): boolean {
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test(value);
}

export async function readLocale(cwd: string, lang: string): Promise<{ path: string; contents: Locale } | undefined> {
  assertValidLang(lang);
  const rel = `${LOCALES_DIR}/${lang}.json`;
  const abs = join(cwd, rel);
  try {
    const obj = parseJsonObject(await readFile(abs, "utf8"), abs);
    const parsed = localeSchema.safeParse(obj);
    if (!parsed.success) {
      throw new ZitadelError("E_VALIDATION", `Locale ${rel} is not a flat string map`, {
        details: { issues: parsed.error.issues },
      });
    }
    return { path: rel, contents: parsed.data };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function writeLocale(
  cwd: string,
  lang: string,
  contents: Locale,
  opts: { dryRun?: boolean } = {},
): Promise<{ path: string }> {
  assertValidLang(lang);
  const rel = `${LOCALES_DIR}/${lang}.json`;
  const abs = join(cwd, rel);
  if (opts.dryRun) return { path: rel };
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${stableStringify(contents)}\n`);
  await rename(tmp, abs);
  return { path: rel };
}

export async function listLocales(cwd: string): Promise<Array<{ lang: string; path: string; key_count: number }>> {
  const dir = join(cwd, LOCALES_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const out: Array<{ lang: string; path: string; key_count: number }> = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const lang = entry.replace(/\.json$/, "");
    if (!isValidLang(lang)) continue;
    const locale = await readLocale(cwd, lang);
    if (!locale) continue;
    out.push({ lang, path: locale.path, key_count: Object.keys(locale.contents).length });
  }
  return out;
}

function assertValidLang(lang: string): void {
  if (!isValidLang(lang)) {
    throw new ZitadelError("E_VALIDATION", `Invalid locale code "${lang}"`, {
      hint: "Use BCP 47 shorthand like `en`, `de`, `pt-BR`.",
    });
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
