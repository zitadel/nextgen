import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as rosie from "rosie-skills";

import { isCI } from "@/lib/ci";
import type { BoxAction } from "@/lib/ui";
import { log } from "@/lib/ui";
import { style } from "@/lib/ui";
import type { SuggestedCommand } from "@/lib/suggestion";
import { telemetryConfigDir } from "@/lib/telemetry/identity";

/** The file that records, once per machine, that the skills were offered. */
const SHOWN_FILE = "skills-hint.json";

/**
 * The agent skills this CLI ships, and the once-per-machine offer to add them.
 * It is the one way into the skills at run time; building the bundle is a
 * separate, build-time concern (`./bundle`) that no run of the CLI imports.
 */
export class Skills {
  /** Where most coding agents read a project's skills: Codex, Cursor, GitHub Copilot, Gemini CLI and more. */
  static readonly SHARED_DIR = ".agents/skills";

  /** Where Claude Code reads them, which reads no other folder. */
  static readonly CLAUDE_DIR = ".claude/skills";

  /** The environment the offer is decided in. */
  private readonly env: NodeJS.ProcessEnv;

  /** False for `--json`, `--non-interactive`, or a non-TTY stream. */
  private readonly interactive: boolean;

  /**
   * @param env - The environment the offer is decided in.
   * @param interactive - Whether someone is watching: false for `--json`,
   *   `--non-interactive`, or a non-TTY stream.
   */
  constructor(env: NodeJS.ProcessEnv, interactive: boolean) {
    this.env = env;
    this.interactive = interactive;
  }

  /**
   * The skills this CLI ships, which its build copied into `dist/skills/`:
   * the set of the release the user runs.
   *
   * @param packageRoot - The CLI package's directory.
   * @returns The skills' names, sorted.
   */
  static async bundled(packageRoot: string): Promise<string[]> {
    const entries = await readdir(Skills.bundleDir(packageRoot), { withFileTypes: true });
    return entries
      .filter((entry) => {
        return entry.isDirectory();
      })
      .map((entry) => {
        return entry.name;
      })
      .sort();
  }

  /**
   * The project's folders to add the skills to: the shared one, and Claude
   * Code's as well when Claude Code is installed on this machine or the
   * project already has a `.claude/` folder, as one a teammate works on with it
   * does.
   *
   * @param projectDir - The project's directory.
   * @returns The folders, relative to it.
   */
  static async dirs(projectDir: string): Promise<string[]> {
    const claude = existsSync(join(projectDir, ".claude")) || (await Skills.claudeCodeInstalled());
    return claude ? [Skills.SHARED_DIR, Skills.CLAUDE_DIR] : [Skills.SHARED_DIR];
  }

  /**
   * Puts each skill's bundled folder at `<dir>/<skill>` in the project,
   * replacing whatever was there: an older version's copy, or the link
   * `npx skills add` leaves, which is removed rather than followed.
   *
   * @param options - What to add and where.
   * @param options.packageRoot - The CLI package's directory.
   * @param options.projectDir - The project's directory.
   * @param options.skills - The skills to add.
   * @param options.dirs - The folders, relative to the project, to add them to.
   */
  static async add(options: {
    packageRoot: string;
    projectDir: string;
    skills: readonly string[];
    dirs: readonly string[];
  }): Promise<void> {
    for (const dir of options.dirs) {
      for (const skill of options.skills) {
        const target = join(options.projectDir, dir, skill);
        await rm(target, { recursive: true, force: true });
        await cp(join(Skills.bundleDir(options.packageRoot), skill), target, { recursive: true });
      }
    }
  }

  /**
   * Whether this machine should be offered the skills, resolved while the
   * command runs. {@link Skills.claim} is what spends the offer, at the moment
   * the summary is built.
   *
   * @returns `true` when the offer is still to be made.
   */
  async eligible(): Promise<boolean> {
    try {
      return (await this.pendingOffer()) !== undefined;
    } catch {
      // Nothing here may fail the command the person actually ran.
      return false;
    }
  }

  /**
   * Spends the once-per-machine offer and returns the step to put in the
   * summary, or `undefined` if another run took it first. Written exclusively,
   * so of two concurrent first runs only one shows it.
   *
   * @param skillsAdd - The `skills add` command, rendered for the run.
   * @returns The step, or `undefined`.
   */
  claim(skillsAdd: SuggestedCommand): BoxAction | undefined {
    try {
      const shownPath = this.shownFile();
      if (shownPath === undefined) {
        return undefined;
      }
      mkdirSync(dirname(shownPath), { recursive: true });
      writeFileSync(shownPath, `${JSON.stringify({ date: new Date().toISOString() })}\n`, {
        flag: "wx",
      });
      return {
        text: "Using an AI coding agent? Add the Zitadel skills to your project so it can work with the CLI:",
        command: skillsAdd,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Tells a developer who has AI coding agents installed how to give them the
   * Zitadel skills, once per machine and after the command's own next steps.
   * The note adds nothing itself: it names `zitadel skills add` and the
   * developer runs it.
   *
   * The marker lives in the user's CLI config directory, not in a project, so a
   * second project on the same machine does not show it again. It is written
   * only once the note is about to be shown, and removed again if showing it
   * fails.
   *
   * Silent in CI, in non-interactive runs, when no agent is detected, once it
   * has been shown, and when `NO_SKILLS_PROMPT` is set. Fail-open: nothing here
   * may fail the command the user actually ran, and losing the race to create
   * the marker (`EEXIST`) just means another run is showing the note.
   *
   * @param skillsAdd - The `skills add` command, rendered for the run.
   */
  async showHint(skillsAdd: SuggestedCommand): Promise<void> {
    try {
      const shownPath = await this.pendingOffer();
      if (shownPath === undefined) {
        return;
      }
      // Created exclusively and before printing: of two concurrent first runs
      // only one gets past `wx`, and an interrupted run never shows the note
      // twice.
      mkdirSync(dirname(shownPath), { recursive: true });
      writeFileSync(shownPath, `${JSON.stringify({ date: new Date().toISOString() })}\n`, {
        flag: "wx",
      });

      try {
        log.info(
          [
            "",
            "Using an AI coding agent?",
            "Add the Zitadel skills to your project to help your agent work with Zitadel's CLI and authentication integrations:",
            "",
            `  ${style.command(skillsAdd)}`,
            "",
            "Optional. You can continue without installing skills.",
          ].join("\n"),
        );
      } catch (error) {
        // Not shown after all, so it must not count as shown.
        unlinkSync(shownPath);
        throw error;
      }
    } catch {
      // A hint must never break `setup` or the root help.
    }
  }

  /**
   * The marker's path when this machine is still to be offered the skills:
   * someone is watching, nothing opts out, an agent is installed, and the offer
   * has not been made before. Reads the filesystem. Both ways of offering the
   * skills decide through this, so the conditions cannot drift apart.
   *
   * @returns The marker's path, or `undefined` when no offer is due.
   */
  private async pendingOffer(): Promise<string | undefined> {
    if (!this.interactive || isCI(this.env) || this.isOptedOut()) {
      return undefined;
    }
    const shownPath = this.shownFile();
    if (shownPath === undefined || existsSync(shownPath)) {
      return undefined;
    }
    return (await rosie.agents()).some((agent) => {
      return agent.detected && agent.installPath !== null;
    })
      ? shownPath
      : undefined;
  }

  /**
   * Where the once-per-machine marker lives.
   *
   * @returns Its path, or `undefined` when the machine has no config directory.
   */
  private shownFile(): string | undefined {
    const configDir = telemetryConfigDir(this.env);
    return configDir === undefined ? undefined : join(configDir, SHOWN_FILE);
  }

  /**
   * Whether `NO_SKILLS_PROMPT` opts out of the offer.
   *
   * @returns `true` when it is set to anything but a falsy value.
   */
  private isOptedOut(): boolean {
    const value = this.env.NO_SKILLS_PROMPT?.trim().toLowerCase();
    return value !== undefined && value !== "" && value !== "0" && value !== "false";
  }

  /**
   * Whether Claude Code is installed on this machine. A detection that fails
   * counts as no: it only decides the extra folder, never whether the skills
   * are added.
   *
   * @returns `true` when it is installed.
   */
  private static async claudeCodeInstalled(): Promise<boolean> {
    try {
      return (await rosie.agents()).some((agent) => {
        return agent.name === "claude" && agent.detected;
      });
    } catch {
      return false;
    }
  }

  /**
   * Where the build puts the bundled skills.
   *
   * @param packageRoot - The CLI package's directory.
   * @returns The bundle's directory.
   */
  private static bundleDir(packageRoot: string): string {
    return join(packageRoot, "dist", "skills");
  }
}
