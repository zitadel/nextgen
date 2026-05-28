import { readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { Orca } from "../lib/orca";
import { tryDetectFramework } from "../lib/orca/detect";
import { patchers } from "../lib/orca/patchers";
import type { EjectActions } from "../lib/orca/patchers/types";
import { scaffolders } from "../lib/orca/scaffolders";
import { MANAGED_MARKER } from "../lib/paths";
import { readZitadelConfig } from "./shared";

/**
 * Options for {@link runEject}. `force` is required to eject in non-interactive
 * mode, since ejecting permanently deletes managed files.
 */
export type EjectOptions = GlobalOptions & {
  force?: boolean;
};

/**
 * Removes Zitadel-managed files from the project, leaving the remote project
 * untouched. The set of files comes from the framework patcher's
 * {@link import("../lib/orca/patchers/types").Patcher.artifacts}, so the patcher
 * is the single source of truth for what its integration owns.
 *
 * Marked code files are removed only when they still carry the managed marker
 * (user-replaced files are preserved); `zitadel.json` is removed; `.env.local`
 * is renamed to a timestamped backup; and `.zitadel/` is removed wholesale.
 * `dryRun` reports without touching the filesystem; non-interactive runs require
 * `force`.
 */
export async function runEject(io: CliIO, opts: EjectOptions): Promise<void> {
  if (!opts.force && opts.nonInteractive) {
    throw new ZitadelError("E_VALIDATION", "Eject requires --force in non-interactive mode", {
      hint: "Re-run with --force to confirm deletion of managed files.",
    });
  }

  const actions = await resolveEjectActions(opts.cwd);
  const removed: string[] = [];
  const preserved: string[] = [];
  const backedUp: string[] = [];

  for (const rel of actions.markedFiles) {
    const abs = join(opts.cwd, rel);
    if (!(await pathExists(abs))) {
      continue;
    }
    const contents = await readFile(abs, "utf8").catch(() => "");
    if (!contents.includes(MANAGED_MARKER)) {
      preserved.push(rel);
      continue;
    }
    if (!opts.dryRun) {
      await rm(abs, { force: true });
    }
    removed.push(rel);
  }

  for (const rel of actions.rootConfigFiles) {
    const abs = join(opts.cwd, rel);
    if (!(await pathExists(abs))) {
      continue;
    }
    if (!opts.dryRun) {
      await rm(abs, { force: true });
    }
    removed.push(rel);
  }

  for (const rel of actions.envBackups) {
    const abs = join(opts.cwd, rel);
    if (!(await pathExists(abs)) || opts.dryRun) {
      continue;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${abs}.ejected-${stamp}`;
    await rename(abs, backup);
    backedUp.push(`${rel} -> ${backup.slice(opts.cwd.length + 1)}`);
  }

  for (const rel of actions.directories) {
    const abs = join(opts.cwd, rel);
    if (!(await pathExists(abs))) {
      continue;
    }
    if (!opts.dryRun) {
      await rm(abs, { recursive: true, force: true });
    }
    removed.push(rel);
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

/**
 * Asks the framework patcher which artifacts it owns. Falls back to the
 * framework-agnostic set (`zitadel.json`, `.zitadel/`, `.env.local`) when the
 * framework or its patcher cannot be resolved, so an orphaned/partial project
 * can still be cleaned up.
 */
async function resolveEjectActions(cwd: string): Promise<EjectActions> {
  const fallback: EjectActions = {
    markedFiles: [],
    rootConfigFiles: ["zitadel.json"],
    directories: [".zitadel"],
    envBackups: [".env.local"],
  };
  const framework = await tryDetectFramework(cwd);
  if (!framework) {
    return fallback;
  }
  try {
    const orca = new Orca(scaffolders, patchers);
    return orca.patcherFor(framework.id).artifacts({
      framework,
      rendererId: await readRendererId(cwd),
    });
  } catch {
    return fallback;
  }
}

/** Reads the configured renderer id from `zitadel.json`, defaulting to `react`. */
async function readRendererId(cwd: string): Promise<string> {
  try {
    const config = await readZitadelConfig(cwd);
    const branding = config.branding;
    if (
      branding !== null &&
      typeof branding === "object" &&
      "renderer" in branding &&
      typeof (branding as { renderer?: unknown }).renderer === "string"
    ) {
      const renderer = (branding as { renderer: string }).renderer;
      return renderer === "default" ? "react" : renderer;
    }
  } catch {
    // No (or unreadable) zitadel.json — fall through to the default renderer.
  }
  return "react";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
