import { Flags } from "@oclif/core";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { createOrca } from "../lib/orca";
import { AGENTS_HEADER, removeGuidanceSection } from "../lib/orca/patchers/rule/guidance";
import type { EjectActions } from "../lib/orca/patchers/types";
import { MANAGED_MARKER } from "../lib/paths";
import { readRendererId, readZitadelConfig } from "../lib/project";
import { shellArg } from "../lib/shell";
import { shellCommand, type SuggestedCommand } from "../lib/suggestion";
import { nextCommandsData } from "../lib/oclif/envelope";
import { Promptable } from "../lib/oclif/promptable";
import type { Summary } from "../lib/ui";

/**
 * Asks the framework patcher which artifacts it owns. Falls back to the
 * framework-agnostic set (`zitadel.json`, `.zitadel/`, `.env.local`,
 * `.env.development.local`) when the framework or its patcher cannot be
 * resolved, so an orphaned/partial project can still be cleaned up.
 */
async function resolveEjectActions(cwd: string): Promise<EjectActions> {
  const fallback: EjectActions = {
    markedFiles: [],
    rootConfigFiles: ["zitadel.json"],
    directories: [".zitadel"],
    envBackups: [".env.local", ".env.development.local"],
    dependencies: [],
    configEdits: [],
    guidanceFiles: ["AGENTS.md", "README.md"],
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

/**
 * Builds the `next_commands` envelope field — manual follow-ups `eject` can't
 * safely run itself: deleting the `.env*.ejected-*` backups it created (only
 * when some were made), and uninstalling the SDK packages the patcher added
 * (the CLI never modifies the user's `package.json` + lockfile +
 * `node_modules` directly; it just suggests the command).
 */
function assembleNextCommands(
  backedUp: ReadonlyArray<string>,
  dependencies: ReadonlyArray<string>,
  // `--cwd` as typed: the backups and the package.json are in that directory,
  // so a command run from the shell's would miss them or touch another project.
  dir: string | undefined,
): ReadonlyArray<SuggestedCommand> {
  const inDir = (command: string) =>
    shellCommand(dir === undefined ? command : `cd ${shellArg(dir)} && ${command}`);
  const commands: SuggestedCommand[] = [];
  if (backedUp.length > 0) {
    // Name only the backups eject actually created (each `backedUp` entry is
    // `<rel> -> <backup>`), so this destructive glob can't also sweep up
    // unrelated `.env*.ejected-*` files a user happens to keep.
    const patterns = backedUp.map((entry) => `${entry.split(" -> ")[0]}.ejected-*`);
    commands.push(inDir(`rm -f ${patterns.join(" ")}`));
  }
  for (const dep of dependencies) {
    commands.push(inDir(`npm uninstall ${dep}`));
  }
  return commands;
}

/**
 * How a declined eject ends. The question was answered on purpose, so the
 * ending states what that answer left in place and the one command that
 * changes it, rather than restating the refusal.
 */
function cancelledSummary(removeIt: SuggestedCommand): Summary {
  return {
    title: "Cancelled, nothing was removed",
    sections: [],
    lines: ["Nothing was removed. Zitadel is still set up in this app."],
    next: [{ text: "Remove it whenever you like:", command: removeIt }],
    boxed: true,
  };
}

/**
 * How an eject with nothing to remove ends. It is the same shape as a
 * declined one — what the app looks like now, then the command that moves it
 * on — because both are a run that changed nothing.
 */
function nothingToEjectSummary(setItUp: SuggestedCommand): Summary {
  return {
    title: "Nothing to remove",
    sections: [],
    lines: ["Zitadel is not set up in this app, so nothing was removed."],
    next: [{ text: "Set it up whenever you like:", command: setItUp }],
    boxed: true,
  };
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
export default class Eject extends Promptable(BaseCommand) {
  static override description = "Remove managed files and local Zitadel state.";
  static override group = CommandGroups.localDevelopment;

  static override heading = "Ejecting Zitadel from this app";

  static override summarises = true;
  static override groupOrder = 5;
  static override aliases = ["uninstall"];
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Remove the managed files without the confirmation prompt.",
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Eject);
    await this.toMeta(flags, { resolveServer: false });
    const { cwd, dryRun } = this.meta;

    // A dry run removes nothing, so it has nothing to confirm (as in `reset`).
    const confirmed =
      dryRun ||
      (await this.input({
        kind: "confirm",
        name: "remove the managed files and local state",
        message: "Remove the managed files and local Zitadel state?",
        retry: this.suggestUnscoped("eject --force"),
      }));
    if (!confirmed) {
      return this.emit({
        status: "skipped",
        reason: "eject-cancelled",
        summary: cancelledSummary(this.suggestUnscoped("eject")),
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

    // Guidance sections live inside user-owned docs (README.md / AGENTS.md):
    // strip only the marker-fenced section so the stale golden path doesn't
    // outlive the files it points at. The whole file goes only when nothing
    // but the scaffold-created header (or whitespace) would remain — i.e. we
    // created it and nobody added anything since.
    for (const rel of actions.guidanceFiles) {
      const abs = join(cwd, rel);
      if (!(await pathExists(abs))) {
        continue;
      }
      const contents = await readFile(abs, "utf8").catch(() => "");
      const stripped = removeGuidanceSection(contents);
      if (stripped === contents) {
        continue;
      }
      const husk = stripped.trim() === "" || stripped.trim() === AGENTS_HEADER.trim();
      if (!dryRun) {
        if (husk) {
          await rm(abs, { force: true });
        } else {
          await writeFile(abs, stripped);
        }
      }
      removed.push(husk ? rel : `${rel} (managed section)`);
    }

    // In-place config merges (vite.config.ts / angular.json / nuxt.config.ts)
    // can't be auto-reverted, so surface them as manual cleanup steps.
    // package.json is not a config block: Angular has its `dev` script added
    // outright, while Next and Nuxt keep theirs and only get the dev-server
    // port pinned into it — one line has to cover both, so it names the
    // script and both ways setup touches it rather than claiming the script
    // itself should go.
    const manualSteps = actions.configEdits.map((rel) => {
      if (rel === "package.json" || rel.endsWith("/package.json")) {
        return `Restore the "dev" script in ${rel} (setup added the script, or pinned its dev-server port)`;
      }
      if (rel === "angular.json" || rel.endsWith("/angular.json")) {
        return `Remove the Zitadel proxyConfig (and dev-server port) from the serve target in ${rel}`;
      }
      return `Remove the Zitadel configuration block from ${rel}`;
    });

    if (removed.length === 0 && backedUp.length === 0 && manualSteps.length === 0) {
      return this.emit({
        status: "skipped",
        reason: "nothing-to-eject",
        data: { cwd },
        summary: nothingToEjectSummary(this.suggestUnscoped("setup")),
      });
    }

    const nextCommands = assembleNextCommands(
      backedUp,
      actions.dependencies,
      typeof flags.cwd === "string" ? flags.cwd : undefined,
    );

    return this.emit({
      status: "ok",
      data: {
        title: "Removed Zitadel from this app, leaving the remote project untouched",
        files_removed: removed,
        files_preserved: preserved,
        backed_up: backedUp,
        ...nextCommandsData(nextCommands),
        manual_steps: manualSteps,
      },
    });
  }
}
