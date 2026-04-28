import { readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { MANAGED_MARKER } from "../lib/paths";
import { ZitadelError } from "../lib/errors";

export type EjectOptions = GlobalOptions & {
  force?: boolean;
};

export async function runEject(io: CliIO, opts: EjectOptions): Promise<void> {
  if (!opts.force && opts.nonInteractive) {
    throw new ZitadelError("E_VALIDATION", "Eject requires --force in non-interactive mode", {
      hint: "Re-run with --force to confirm deletion of managed files.",
    });
  }

  const removed: string[] = [];
  const preserved: string[] = [];
  const backedUp: string[] = [];

  const candidates = [
    "zitadel.json",
    ".zitadel/schemas/user.json",
    ".zitadel/flows/default.json",
    ".zitadel/locales/en.json",
    ".zitadel/state.json",
    ".zitadel/secret",
    "app/login/page.tsx",
    "app/register/page.tsx",
    "app/zitadel-provider.tsx",
    "src/app/login/page.tsx",
    "src/app/register/page.tsx",
    "src/app/zitadel-provider.tsx",
  ];

  for (const rel of candidates) {
    const abs = join(opts.cwd, rel);
    const exists = await pathExists(abs);
    if (!exists) continue;
    if (rel.endsWith(".tsx")) {
      const contents = await readFile(abs, "utf8").catch(() => "");
      if (!contents.includes(MANAGED_MARKER)) {
        preserved.push(rel);
        continue;
      }
    }
    if (opts.dryRun) {
      removed.push(rel);
      continue;
    }
    await rm(abs, { recursive: true, force: true });
    removed.push(rel);
  }

  const envLocal = join(opts.cwd, ".env.local");
  if (await pathExists(envLocal) && !opts.dryRun) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = join(opts.cwd, `.env.local.ejected-${stamp}`);
    await rename(envLocal, backup);
    backedUp.push(`.env.local -> ${backup.slice(opts.cwd.length + 1)}`);
  }

  const zitadelDir = join(opts.cwd, ".zitadel");
  if (await pathExists(zitadelDir) && !opts.dryRun) {
    await rm(zitadelDir, { recursive: true, force: true });
  }

  if (removed.length === 0 && backedUp.length === 0) {
    skipped(io, "nothing-to-eject", opts, { cwd: opts.cwd });
    return;
  }

  ok(
    io,
    {
      title: "Zitadel ejected. Remote project is untouched.",
      files_removed: removed,
      files_preserved: preserved,
      backed_up: backedUp,
      next_commands: ["rm -rf .zitadel.* (optional cleanup of backups)"],
    },
    opts,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
