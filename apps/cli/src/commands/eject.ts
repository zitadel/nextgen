import { readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { ZitadelError } from "../lib/errors";
import { BaseCommand, type JsonEnvelope } from "../lib/oclif";
import { createOrca } from "../lib/orca";
import {
  edgeProxyConfigEdits,
  edgeProxyDeps,
  edgeProxyEnvBackups,
  edgeProxyFiles,
} from "../lib/orca/patchers/rule/edge-proxy";
import type { EjectActions } from "../lib/orca/patchers/types";
import { MANAGED_MARKER } from "../lib/paths";
import { readDeployTarget, readRendererId, readZitadelConfig } from "../lib/project";

/**
 * Asks the framework patcher which artifacts it owns. Falls back to the
 * framework-agnostic set (`zitadel.json`, `.zitadel/`, `.env.local`) when the
 * framework or its patcher cannot be resolved, so an orphaned/partial project
 * can still be cleaned up.
 */
async function resolveEjectActions(cwd: string): Promise<EjectActions> {
  // Read the persisted config up front so the fallback (used when no framework
  // patcher is available) still cleans up the edge-proxy artifacts recorded in
  // zitadel.json — otherwise the worker file and its secret env file leak.
  const config = await readZitadelConfig(cwd).catch(() => ({}) as Record<string, unknown>);
  const deployTarget = readDeployTarget(config);
  const fallback: EjectActions = {
    markedFiles: deployTarget ? edgeProxyFiles(deployTarget) : [],
    rootConfigFiles: ["zitadel.json"],
    directories: [".zitadel"],
    envBackups: [".env.local", ...(deployTarget ? edgeProxyEnvBackups(deployTarget) : [])],
    dependencies: deployTarget ? edgeProxyDeps(deployTarget) : [],
    configEdits: deployTarget ? edgeProxyConfigEdits(deployTarget) : [],
  };
  const orca = createOrca();
  const framework = await orca.tryDetect(cwd);
  if (!framework) {
    return fallback;
  }
  try {
    return orca.patcherFor(framework.id).artifacts({
      framework,
      rendererId: readRendererId(config),
      deployTarget,
    });
  } catch {
    return fallback;
  }
}

/**
 * Builds the `next_commands` envelope field — manual follow-ups `eject` can't
 * safely run itself: deleting the `.env.local.ejected-*` backups it created
 * (only when some were made), and uninstalling the SDK packages the patcher
 * added (the CLI never modifies the user's `package.json` + lockfile +
 * `node_modules` directly; it just suggests the command).
 */
function assembleNextCommands(
  backedUp: ReadonlyArray<unknown>,
  dependencies: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const commands: string[] = [];
  if (backedUp.length > 0) {
    commands.push("rm -f .env.local.ejected-*");
  }
  for (const dep of dependencies) {
    commands.push(`npm uninstall ${dep}`);
  }
  return commands;
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

    // In-place config merges (vite.config.ts / angular.json / nuxt.config.ts)
    // can't be auto-reverted, so surface them as manual cleanup steps. The
    // Angular patcher also edits package.json (a `dev` script, not a config
    // block), so word that one accurately.
    //
    // Drop concrete paths that don't exist (e.g. wrangler.jsonc when the project
    // only has wrangler.toml and setup never created the jsonc), so the guidance
    // never points at a file that isn't there. Glob entries (vite.config.*) are
    // kept since they never match a literal path.
    const presentConfigEdits: string[] = [];
    for (const rel of actions.configEdits) {
      if (rel.includes("*") || (await pathExists(join(cwd, rel)))) {
        presentConfigEdits.push(rel);
      }
    }
    const manualSteps = presentConfigEdits.map((rel) => {
      if (rel === "package.json" || rel.endsWith("/package.json")) {
        return `Remove the "dev" script setup added to ${rel}`;
      }
      if (rel === "angular.json" || rel.endsWith("/angular.json")) {
        return `Remove the Zitadel proxyConfig (and dev-server port) from the serve target in ${rel}`;
      }
      if (rel === "wrangler.jsonc") {
        return `Remove the edge-proxy worker config from ${rel} (delete the file if setup created it)`;
      }
      return `Remove the Zitadel configuration block from ${rel}`;
    });

    if (removed.length === 0 && backedUp.length === 0 && manualSteps.length === 0) {
      return this.emit({ status: "skipped", reason: "nothing-to-eject", data: { cwd } });
    }

    const nextCommands = assembleNextCommands(backedUp, actions.dependencies);

    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel ejected. Remote project is untouched.",
        files_removed: removed,
        files_preserved: preserved,
        backed_up: backedUp,
        next_commands: nextCommands,
        manual_steps: manualSteps,
      },
    });
  }
}
