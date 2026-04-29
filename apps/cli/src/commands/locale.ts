import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { flowDefinitionSchema, collectTextKeys } from "../resources/flow";
import {
  DEFAULT_LOCALE,
  listLocales as listLocaleFiles,
  readLocale,
  writeLocale,
} from "../resources/locale";

export type LocaleScaffoldOptions = GlobalOptions & {
  lang?: string;
};

export async function runLocaleScaffold(io: CliIO, opts: LocaleScaffoldOptions): Promise<void> {
  const lang = opts.lang ?? DEFAULT_LOCALE;
  const referencedKeys = await collectReferencedKeys(opts.cwd);
  const existing = (await readLocale(opts.cwd, lang))?.contents ?? {};
  const next: Record<string, string> = { ...existing };
  const addedKeys: string[] = [];
  for (const key of referencedKeys) {
    if (!(key in next)) {
      next[key] = "";
      addedKeys.push(key);
    }
  }
  const orphanedKeys = Object.keys(existing)
    .filter((key) => !referencedKeys.includes(key))
    .sort();

  const changed = addedKeys.length > 0;
  if (changed && !opts.dryRun) {
    await writeLocale(opts.cwd, lang, next);
  }

  ok(
    io,
    {
      title: changed ? `Locale "${lang}" updated.` : `Locale "${lang}" is up to date.`,
      lang,
      path: `.zitadel/locales/${lang}.json`,
      changed,
      added_keys: addedKeys,
      orphaned_keys: orphanedKeys,
      key_count: Object.keys(next).length,
      dry_run: Boolean(opts.dryRun),
      next_commands: orphanedKeys.length > 0 ? ["zitadel locale list"] : [],
    },
    opts,
    orphanedKeys.map((key) => `Orphaned key "${key}" (not referenced by any flow).`),
  );
}

export async function runLocaleList(io: CliIO, opts: GlobalOptions): Promise<void> {
  const locales = await listLocaleFiles(opts.cwd);
  ok(
    io,
    {
      title: `Found ${locales.length} locale${locales.length === 1 ? "" : "s"}.`,
      locales,
    },
    opts,
  );
}

async function collectReferencedKeys(cwd: string): Promise<string[]> {
  const flowsDir = join(cwd, ".zitadel/flows");
  let entries: string[];
  try {
    entries = await readdir(flowsDir);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      throw new ZitadelError(
        "E_VALIDATION",
        "No .zitadel/flows directory — run `zitadel setup` first.",
        {
          nextCommands: ["zitadel setup"],
        },
      );
    }
    throw error;
  }
  const keys = new Set<string>();
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const abs = join(flowsDir, entry);
    const parsed = flowDefinitionSchema.safeParse(JSON.parse(await readFile(abs, "utf8")));
    if (!parsed.success) {
      throw new ZitadelError("E_VALIDATION", `Flow ${entry} is not a valid FlowDefinition`, {
        details: { path: abs, issues: parsed.error.issues },
      });
    }
    for (const key of collectTextKeys(parsed.data)) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}
