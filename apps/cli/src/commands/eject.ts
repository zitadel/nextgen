import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Flags } from "@oclif/core";

import { Cmd } from "@/lib/cmd";
import { Consent } from "@/lib/consent";
import { CANCELLED } from "@/lib/errors";
import { pathExists } from "@/lib/fs";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type CommandResult,
  type JsonEnvelope,
} from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import { createOrca } from "@/lib/orca";
import { AGENTS_HEADER, removeGuidanceSection } from "@/lib/orca/patchers/rule/guidance";
import type { EjectActions } from "@/lib/orca/patchers/types";
import { MANAGED_MARKER } from "@/lib/paths";
import { readRendererId, readZitadelConfig } from "@/lib/project";
import { removeCommandFor } from "@/lib/package-manager";
import {
  type SuggestedCommand,
  shellCommand,
  shellSteps,
  suggestedCommandOf,
} from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";

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
    const config = await readZitadelConfig(cwd).catch(() => {
      return {} as Record<string, unknown>;
    });
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
  const inDir = (command: SuggestedCommand) => {
    return dir === undefined ? command : shellSteps(shellCommand("cd", Cmd.quote(dir)), command);
  };
  const commands: SuggestedCommand[] = [];
  if (backedUp.length > 0) {
    // Name only the backups eject actually created (each `backedUp` entry is
    // `<rel> -> <backup>`), so this destructive glob can't also sweep up
    // unrelated `.env*.ejected-*` files a user happens to keep.
    const patterns = backedUp.map((entry) => {
      return `${Cmd.quote(entry.split(" -> ")[0] ?? "")}.ejected-*`;
    });
    commands.push(inDir(shellCommand("rm", "-f", ...patterns)));
  }
  for (const dep of dependencies) {
    commands.push(inDir(suggestedCommandOf(removeCommandFor("npm", [dep]))));
  }
  return commands;
}

/** What {@link ejectProject} did, or with `"plan"` would do. */
type Ejection = {
  actions: EjectActions;
  removed: string[];
  preserved: string[];
  backedUp: string[];
};

/**
 * Walk the artifacts the patcher owns. With `"plan"` it only reports what it
 * would remove; removing them takes the consent `eject` asked for.
 */
async function ejectProject(cwd: string, permit: "plan" | Consent): Promise<Ejection> {
  const dryRun = permit === "plan";
  if (!dryRun) {
    Consent.assert(permit);
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
    const contents = await readFile(abs, "utf8").catch(() => {
      return "";
    });
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
      await rm(abs, {
        recursive: true,
        force: true,
      });
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
  };
}

/** The result of an ejection, or of its plan. */
function ejected(
  cwd: string,
  { actions, removed, preserved, backedUp }: Ejection,
  // `--cwd` as typed, for the follow-up commands.
  dir: string | undefined,
  setItUp: SuggestedCommand,
  // Given only for a dry run, whose one follow-up is the ejection itself.
  ejectForReal?: SuggestedCommand,
): CommandResult {
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

  // The manual steps are not weighed: a patcher lists the config it edits whether
  // or not setup ever ran, so an app with nothing of ours in it would otherwise
  // be reported as having had Zitadel removed.
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
  // What the terminal draws, since a person reads no envelope.
  const lines = [
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
    const title =
      "Would remove Zitadel from this app, leaving the remote project untouched (dry run)";

    return {
      status: "ok",
      data: {
        dry_run: true,
        title,
        files_removed: removed,
        files_preserved: preserved,
        backed_up: backedUp,
        manual_steps: manualSteps,
      },
      summary: {
        title,
        sections: [],
        lines,
      },
      next: { commands: [ejectForReal] },
    };
  }

  const title = "Removed Zitadel from this app, leaving the remote project untouched";

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
      lines,
    },
    next: { commands: assembleNextCommands(backedUp, actions.dependencies, dir) },
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
export default class Eject extends Destructive(BaseCommand) {
  static override description = "Remove managed files and local Zitadel state.";
  static override group = CommandGroups.localDevelopment;
  static override groupOrder = 5;

  static override aliases = ["uninstall"];
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Remove the managed files and local state without the confirmation prompt. Required when non-interactive.",
    }),
  };

  static override meta = {
    resolveServer: false,
  };

  protected async execute({ flags }: Admitted<typeof Eject>): Promise<JsonEnvelope> {
    const dir = typeof flags.cwd === "string" ? flags.cwd : undefined;
    const setItUp = this.suggest({ id: "setup" });

    const result = await this.confirmed({
      verb: "eject",
      name: "remove the managed files and local state",
      message: "Remove the managed files and local Zitadel state?",
      preview: async () => {
        return ejected(
          this.cwd,
          await ejectProject(this.cwd, "plan"),
          dir,
          setItUp,
          await this.again("eject", { without: ["dryRun"], with: { force: true } }),
        );
      },
      apply: async (consent) => {
        return ejected(this.cwd, await ejectProject(this.cwd, consent), dir, setItUp);
      },
    });

    return this.emit(
      result.status === "skipped" && result.reason === "eject-cancelled"
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
        : result,
    );
  }
}
