import { existsSync } from "node:fs";
import { cp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import * as rosie from "rosie-skills";

/** Where most coding agents read a project's skills: Codex, Cursor, GitHub Copilot, Gemini CLI and more. */
export const SHARED_SKILLS_DIR = ".agents/skills";

/** Where Claude Code reads them, which reads no other folder. */
export const CLAUDE_SKILLS_DIR = ".claude/skills";

/**
 * The skills this CLI ships, which its build copied into `dist/skills/`
 * (`./bundle.ts`): the set of the release the user runs.
 */
export async function bundledSkills(packageRoot: string): Promise<string[]> {
  const entries = await readdir(bundleDir(packageRoot), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The project's folders to add the skills to: the shared one, and Claude
 * Code's as well when Claude Code is installed on this machine or the project
 * already has a `.claude/` folder, as one a teammate works on with it does.
 */
export async function skillDirs(projectDir: string): Promise<string[]> {
  const claude =
    existsSync(join(projectDir, ".claude")) ||
    (await rosie.agents()).some((agent) => agent.name === "claude" && agent.detected);
  return claude ? [SHARED_SKILLS_DIR, CLAUDE_SKILLS_DIR] : [SHARED_SKILLS_DIR];
}

/**
 * Puts each skill's bundled folder at `<dir>/<skill>` in the project,
 * replacing whatever was there: an older version's copy, or the link
 * `npx skills add` leaves, which is removed rather than followed.
 */
export async function addSkills(options: {
  packageRoot: string;
  projectDir: string;
  skills: readonly string[];
  dirs: readonly string[];
}): Promise<void> {
  for (const dir of options.dirs) {
    for (const skill of options.skills) {
      const target = join(options.projectDir, dir, skill);
      await rm(target, { recursive: true, force: true });
      await cp(join(bundleDir(options.packageRoot), skill), target, { recursive: true });
    }
  }
}

function bundleDir(packageRoot: string): string {
  return join(packageRoot, "dist", "skills");
}
