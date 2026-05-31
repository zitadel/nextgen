import { readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import { createOrca } from "../lib/orca";
import type { EjectActions } from "../lib/orca/patchers/types";
import { MANAGED_MARKER } from "../lib/paths";
import { readRendererId, readZitadelConfig } from "../lib/project";

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
    // No framework → we can't know which SDK package to suggest uninstalling.
    dependencies: [],
  };
  const orca = createOrca();
  const framework = await orca.tryDetect(cwd);
  if (!framework) {
    return fallback;
  }
  try {
    const config = await readZitadelConfig(cwd).catch(() => ({}) as Record<string, unknown>);
    return orca.patcherFor(framework.id).artifacts({
      framework,
      rendererId: readRendererId(config),
    });
  } catch {
    return fallback;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `zitadel eject` — remove managed files and local Zitadel state.
 *
 * Removes Zitadel-managed files from the project, leaving the remote project
 * untouched. The set of files comes from the framework patcher's
 * {@link import("../lib/orca/patchers/types").Patcher.artifacts}, so the patcher
 * is the single source of truth for what its integration owns.
 *
 * Marked code files are removed only when they still carry the managed marker
 * (user-replaced files are preserved); `zitadel.json` is removed; `.env.local`
 * is renamed to a timestamped backup; and `.zitadel/` is removed wholesale.
 * `--dry-run` reports without touching the filesystem; non-interactive runs
 * require `--force`.
 */
export default class Eject extends BaseCommand {
  static override description = "Remove managed files and local Zitadel state.";
  static override aliases = ["uninstall"];

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Eject);
    await this.toMeta(flags);
    const { cwd, force, nonInteractive, dryRun } = this.meta;

    if (!force && nonInteractive) {
      throw new ZitadelError("E_VALIDATION", "Eject requires --force in non-interactive mode", {
        hint: "Re-run with --force to confirm deletion of managed files.",
      });
    }

    const actions = await resolveEjectActions(cwd);
    const removed: string[] = [];
    const preserved: string[] = [];
    const backedUp: string[] = [];

    for (const rel of actions.markedFiles) {
      const abs = join(cwd, rel);
      if (!(await pathExists(abs))) {
        continue;
      }
      const contents = await readFile(abs, "utf8").catch(() => "");
      if (!contents.includes(MANAGED_MARKER)) {
        preserved.push(rel);
        continue;
      }
      if (!dryRun) {
        await rm(abs, { force: true });
      }
      removed.push(rel);
    }

    for (const rel of actions.rootConfigFiles) {
      const abs = join(cwd, rel);
      if (!(await pathExists(abs))) {
        continue;
      }
      if (!dryRun) {
        await rm(abs, { force: true });
      }
      removed.push(rel);
    }

    for (const rel of actions.envBackups) {
      const abs = join(cwd, rel);
      if (!(await pathExists(abs))) {
        continue;
      }
      if (dryRun) {
        backedUp.push(`${rel} -> ${rel}.ejected-<timestamp>`);
        continue;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = `${abs}.ejected-${stamp}`;
      await rename(abs, backup);
      backedUp.push(`${rel} -> ${backup.slice(cwd.length + 1)}`);
    }

    for (const rel of actions.directories) {
      const abs = join(cwd, rel);
      if (!(await pathExists(abs))) {
        continue;
      }
      if (!dryRun) {
        await rm(abs, { recursive: true, force: true });
      }
      removed.push(rel);
    }

    if (removed.length === 0 && backedUp.length === 0) {
      return this.emit({ status: "skipped", reason: "nothing-to-eject", data: { cwd } });
    }

    // next_commands assembles the manual follow-ups eject can't safely do
    // itself: deleting the env backups (only when some were made), and
    // uninstalling the SDK packages the patcher added (we don't touch the
    // user's package.json + lockfile + node_modules; we just suggest it).
    const nextCommands: string[] = [];
    if (backedUp.length > 0) {
      nextCommands.push("rm -f .env.local.ejected-*");
    }
    for (const dep of actions.dependencies) {
      nextCommands.push(`npm uninstall ${dep}`);
    }

    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel ejected. Remote project is untouched.",
        files_removed: removed,
        files_preserved: preserved,
        backed_up: backedUp,
        next_commands: nextCommands,
      },
    });
  }
}
