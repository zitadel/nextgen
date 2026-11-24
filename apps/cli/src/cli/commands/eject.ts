import { dryRunResult } from "@/cli/core/crud/shared";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { LocalRuntime } from "@/lib/server";
import { Cmd } from "@/lib/cmd";
import { Consent } from "@/lib/consent";
import { CANCELLED } from "@/lib/errors";
import { pathExists } from "@/lib/fs";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { createOrca, Orca } from "@/lib/orca";
import { LAUNCHER_PATH } from "@/lib/orca/patchers/rule/angular/templates";
import { AGENTS_HEADER, removeGuidanceSection } from "@/lib/orca/patchers/rule/guidance";
import type { EjectActions } from "@/lib/orca/patchers/types";
import { PM } from "@/lib/pm";
import {
  shellCommand,
  shellSteps,
  type SuggestedCommand,
  suggestedCommandOf,
} from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { Project } from "@/lib/project";
import { Previewable } from "@/cli/core/previewable";
import { Destructive } from "@/cli/core/destructive";
import { BaseCommand } from "@/cli/core";

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
  const orca = createOrca(LocalRuntime.DIR);
  const framework = await orca.tryDetect(cwd);
  if (!framework) {
    return fallback;
  }
  try {
    const config = await Project.at(cwd).configOrEmpty();
    return orca.patcherFor(framework.id).artifacts({
      framework,
      rendererId: config.rendererId,
    });
  } catch {
    return fallback;
  }
}

/** What {@link ejectProject} did, or with `"plan"` would do. */
type Ejection = {
  actions: EjectActions;
  removed: string[];
  preserved: string[];
  backedUp: string[];
  /** The project's own package manager, which removes the SDK packages it added. */
  packageManager: PM;
};

/**
 * Walk the artifacts the patcher owns. With `"plan"` it only reports what it
 * would remove; removing them takes the consent `eject` asked for. The
 * package manager is read before anything is removed, so nothing the ejection
 * deletes can change it.
 *
 * Guidance sections live inside user-owned docs (README.md / AGENTS.md), so
 * only the marker-fenced section is stripped, which keeps the stale golden path
 * from outliving the files it points at. The whole file goes only when nothing
 * but the scaffold-created header (or whitespace) would remain, that is, when
 * eject created it and nobody added anything since.
 *
 * @param cwd - The project directory.
 * @param permit - `"plan"` to only report, or the consent to remove.
 * @returns What was removed, preserved and backed up.
 */
async function ejectProject(cwd: string, permit: "plan" | Consent): Promise<Ejection> {
  const dryRun = permit === "plan";
  if (!dryRun) {
    Consent.assert(permit);
  }
  const [actions, packageManager] = await Promise.all([resolveEjectActions(cwd), PM.detect(cwd)]);
  const removed: string[] = [];
  const preserved: string[] = [];
  const backedUp: string[] = [];

  for (const rel of actions.markedFiles) {
    const abs = join(cwd, rel);
    if (!(await pathExists(abs))) {
      continue;
    }
    const contents = await readFile(abs, "utf8").catch(() => {
      return "";
    });
    if (!Orca.isManaged(contents)) {
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
      backedUp.push(`${rel} -> ${Project.ejectedBackup(rel, "<timestamp>")}`);
      continue;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = Project.ejectedBackup(abs, stamp);
    await rename(abs, backup);
    backedUp.push(`${rel} -> ${backup.slice(cwd.length + 1)}`);
  }

  for (const rel of actions.directories) {
    const abs = join(cwd, rel);
    if (!(await pathExists(abs))) {
      continue;
    }
    if (!dryRun) {
      await rm(abs, {
        recursive: true,
        force: true,
      });
    }
    removed.push(rel);
  }

  for (const rel of actions.guidanceFiles) {
    const abs = join(cwd, rel);
    if (!(await pathExists(abs))) {
      continue;
    }
    const contents = await readFile(abs, "utf8").catch(() => {
      return "";
    });
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
  return {
    actions,
    removed,
    preserved,
    backedUp,
    packageManager,
  };
}

/**
 * The result of an ejection, or of its plan.
 *
 * In-place config merges (vite.config.ts / angular.json / nuxt.config.ts)
 * cannot be auto-reverted, so they surface as manual cleanup steps.
 * package.json is not a config block: Angular has its `dev` script added
 * outright, while Next and Nuxt keep theirs and only get the dev-server port
 * pinned into it. One line has to cover both, so it names the script and both
 * ways setup touches it rather than claiming the script itself should go. An
 * Angular app's scripts also run its launcher, which eject removes, so they
 * need moving back to `ng`.
 *
 * The manual steps are not weighed when deciding that nothing was ejected: a
 * patcher lists the config it edits whether or not setup ever ran, so an app
 * with nothing of ours in it would otherwise be reported as having had Zitadel
 * removed.
 *
 * The follow-ups are the manual steps `eject` cannot safely run itself:
 * deleting the `.env*.ejected-*` backups it created (only when some were made),
 * and uninstalling the SDK packages the patcher added (the CLI never modifies
 * the user's `package.json`, lockfile or `node_modules` directly; it just
 * suggests the command). Only the backups eject actually created are named
 * (each `backedUp` entry is `<rel> -> <backup>`), so the destructive glob
 * cannot also sweep up unrelated `.env*.ejected-*` files a user happens to keep.
 * They run in `--cwd` as typed, since the backups and the package.json are in
 * that directory, and use the project's own package manager, since another one
 * would write a lockfile of its own.
 *
 * @param cwd - The project directory.
 * @param ejection - What the ejection did, or would do.
 * @param dir - `--cwd` as typed, for the follow-up commands.
 * @param setItUp - The command that sets the app up again.
 * @param ejectForReal - Given only for a dry run, whose one follow-up is the
 *   ejection itself.
 * @returns The envelope of the run.
 */
function ejected(
  cwd: string,
  { actions, removed, preserved, backedUp, packageManager }: Ejection,
  dir: string | undefined,
  setItUp: SuggestedCommand,
  ejectForReal?: SuggestedCommand,
): CommandResult {
  const manualSteps = actions.configEdits.map((rel) => {
    if (rel === "package.json" || rel.endsWith("/package.json")) {
      const launched = actions.markedFiles.includes(LAUNCHER_PATH)
        ? `, and run every script that runs "node ${LAUNCHER_PATH}" with "ng" again`
        : "";
      return `Restore the "dev" script in ${rel} (setup added the script, or pinned its dev-server port)${launched}`;
    }
    if (rel === "angular.json" || rel.endsWith("/angular.json")) {
      return `Remove the Zitadel proxyConfig (and dev-server port) from the serve target in ${rel}`;
    }
    return `Remove the Zitadel configuration block from ${rel}`;
  });

  if (removed.length === 0 && backedUp.length === 0) {
    if (ejectForReal !== undefined) {
      const title = "Nothing would be removed (dry run)";

      return {
        status: "ok",
        data: {
          dry_run: true,
          title,
        },
        summary: {
          title,
          sections: [],
          lines: ["Zitadel is not set up in this app, so nothing would be removed."],
          next: [
            {
              text: "Set it up whenever you like:",
              command: setItUp,
            },
          ],
        },
        next: { commands: [setItUp] },
      };
    }

    return {
      status: "skipped",
      reason: "nothing-to-eject",
      data: { title: "Nothing to remove", cwd },
      summary: {
        title: "Nothing to remove",
        sections: [],
        lines: ["Zitadel is not set up in this app, so nothing was removed."],
        next: [
          {
            text: "Set it up whenever you like:",
            command: setItUp,
          },
        ],
      },
      next: { commands: [setItUp] },
    };
  }

  const dry = ejectForReal !== undefined;
  const terminalLines = [
    ...removed.map((file) => {
      return `${dry ? "Would remove" : "Removed"} ${escapeControlCharacters(file)}`;
    }),
    ...preserved.map((file) => {
      return `Kept ${escapeControlCharacters(file)}`;
    }),
    ...backedUp.map((entry) => {
      return `${dry ? "Would back up" : "Backed up"} ${escapeControlCharacters(entry)}`;
    }),
    ...manualSteps.map((step) => {
      return escapeControlCharacters(step);
    }),
  ];

  if (ejectForReal !== undefined) {
    const result = dryRunResult({
      verb: "remove",
      topic: "zitadel",
      noun: "Zitadel from this app, leaving the remote project untouched",
      next: ejectForReal,
    });

    return {
      ...result,
      data: {
        ...(result.data as object),
        files_removed: removed,
        files_preserved: preserved,
        backed_up: backedUp,
        manual_steps: manualSteps,
      },
      summary: {
        ...result.summary,
        lines: terminalLines,
      },
    };
  }

  const title = "Removed Zitadel from this app, leaving the remote project untouched";
  const inDir = (command: SuggestedCommand) => {
    return dir === undefined ? command : shellSteps(shellCommand("cd", Cmd.quote(dir)), command);
  };
  const patterns = backedUp.map((entry) => {
    return `${Cmd.quote(entry.split(" -> ")[0] ?? "")}.ejected-*`;
  });

  return {
    status: "ok",
    data: {
      title,
      files_removed: removed,
      files_preserved: preserved,
      backed_up: backedUp,
      manual_steps: manualSteps,
    },
    summary: {
      title,
      sections: [],
      lines: terminalLines,
    },
    next: {
      commands: [
        ...(backedUp.length > 0 ? [inDir(shellCommand("rm", "-f", ...patterns))] : []),
        ...actions.dependencies.map((dep) => {
          return inDir(suggestedCommandOf(packageManager.remove([dep])));
        }),
      ],
    },
  };
}

/**
 * `zitadel eject` — remove managed files and local Zitadel state.
 *
 * Removes Zitadel-managed files from the project, leaving the remote project
 * untouched. The set of files comes from the framework patcher's
 * {@link import("@/lib/orca/patchers/types").Patcher.artifacts}, so the patcher
 * is the single source of truth for what its integration owns.
 *
 * Marked code files are removed only when they still carry the managed marker
 * (user-replaced files are preserved); `zitadel.json` is removed; `.env.local`
 * is renamed to a timestamped backup; and `.zitadel/` is removed wholesale.
 */
export default class Eject extends Destructive(
  Previewable(BaseCommand),
  "Remove the managed files and local state without the confirmation prompt. Required when non-interactive.",
) {
  static override description = "Remove managed files and local Zitadel state.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 7;

  static override examples = [
    "<%= config.bin %> eject",
    "<%= config.bin %> eject --dry-run",
    "<%= config.bin %> eject --force",
  ];

  static override aliases = ["uninstall"];
  /**
   * Says what ejecting would remove, without removing it.
   *
   * @param input - The flags and arguments of the run.
   * @returns The dry run's envelope.
   */
  protected async preview({ flags }: Admitted<typeof Eject>): Promise<CommandResult> {
    const dir = typeof flags.cwd === "string" ? flags.cwd : undefined;
    const setItUp = this.suggest({ id: "setup" });

    return ejected(
      this.cwd,
      await ejectProject(this.cwd, "plan"),
      dir,
      setItUp,
      await this.again("eject", {
        without: ["dryRun"],
        with: { force: true },
      }),
    );
  }

  /**
   * Removes the managed files and local state, after asking.
   *
   * @param input - The flags and arguments of the run.
   * @returns The run's envelope.
   */
  protected async apply({ flags }: Admitted<typeof Eject>): Promise<CommandResult> {
    const dir = typeof flags.cwd === "string" ? flags.cwd : undefined;
    const setItUp = this.suggest({ id: "setup" });

    const result = await this.confirmed({
      verb: "eject",
      name: "remove the managed files and local state",
      message: "Remove the managed files and local Zitadel state?",
      apply: async (consent) => {
        return ejected(this.cwd, await ejectProject(this.cwd, consent), dir, setItUp);
      },
    });

    return result.status === "skipped" && result.reason === "eject-cancelled"
      ? {
          ...result,
          next: { commands: [await this.realRun()] },
          summary: {
            title: CANCELLED,
            sections: [],
            lines: ["Nothing was removed. Zitadel is still set up in this app."],
            next: [
              {
                text: "Remove it whenever you like:",
                command: await this.realRun(),
              },
            ],
          },
        }
      : result;
  }
}
