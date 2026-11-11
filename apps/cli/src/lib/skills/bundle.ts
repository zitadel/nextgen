import { cp, glob, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { parse } from "yaml";

/**
 * Where the repository keeps its agent skills, one `<name>/SKILL.md` per
 * skill: the root router and components skills, and each app's and package's
 * own. The same set `npx skills add zitadel/nextgen --full-depth` finds.
 */
const SKILL_FILES = [
  "skills/*/SKILL.md",
  "apps/*/skills/*/SKILL.md",
  "packages/*/skills/*/SKILL.md",
];

export type SkillSource = {
  /** The skill's `name`, which is also its folder's name. */
  name: string;
  /** The folder holding its `SKILL.md` and the files it references. */
  dir: string;
};

/**
 * Every skill in the repository a user installs: all but those whose
 * frontmatter sets `metadata.internal`, which are for working on this
 * repository. Fails on a skill whose `name` is not its folder's, or on two
 * skills of one name, since an agent tells skills apart by name alone.
 *
 * Build-time only: `yaml` is a devDependency, so nothing the CLI runs may
 * import this module.
 */
export async function publicSkills(repoRoot: string): Promise<SkillSource[]> {
  const skills = new Map<string, SkillSource>();
  for await (const file of glob(SKILL_FILES, { cwd: repoRoot })) {
    const dir = join(repoRoot, dirname(file));
    const frontmatter = await readFrontmatter(join(repoRoot, file));
    if (frontmatter.metadata?.internal === true) {
      continue;
    }
    const name = frontmatter.name;
    if (name !== basename(dir)) {
      throw new Error(`${file} is named ${String(name)}, not after its folder`);
    }
    const other = skills.get(name);
    if (other) {
      throw new Error(`${file} and ${other.dir} are both named ${name}`);
    }
    skills.set(name, { name, dir });
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copies {@link publicSkills} into `outDir`, one folder per skill, for
 * `zitadel skills add` to install. Returns the names it copied.
 */
export async function bundleSkills(repoRoot: string, outDir: string): Promise<string[]> {
  const skills = await publicSkills(repoRoot);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const skill of skills) {
    await cp(skill.dir, join(outDir, skill.name), { recursive: true });
  }
  return skills.map((skill) => skill.name);
}

type Frontmatter = { name?: unknown; metadata?: { internal?: unknown } };

async function readFrontmatter(file: string): Promise<Frontmatter> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(await readFile(file, "utf8"));
  if (!match) {
    throw new Error(`${file} has no frontmatter`);
  }
  return (parse(match[1] ?? "") ?? {}) as Frontmatter;
}
