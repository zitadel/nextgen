import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { bundleSkills, publicSkills } from "../../../../src/lib/skills/bundle";

let repo: string;
let out: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "zitadel-skills-repo-"));
  out = join(await mkdtemp(join(tmpdir(), "zitadel-skills-out-")), "skills");
});

async function aSkill(path: string, frontmatter: string, files: string[] = []): Promise<void> {
  const dir = join(repo, path);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Skill\n`);
  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), "reference\n");
  }
}

describe("publicSkills", () => {
  it("finds the skills of the root, the apps and the packages", async () => {
    await aSkill("skills/zitadel", "name: zitadel");
    await aSkill("apps/cli/skills/zitadel-cli", "name: zitadel-cli");
    await aSkill("packages/sdk-next/skills/zitadel-sdk-next", "name: zitadel-sdk-next");

    const skills = await publicSkills(repo);

    expect(skills.map((skill) => skill.name)).toEqual([
      "zitadel",
      "zitadel-cli",
      "zitadel-sdk-next",
    ]);
  });

  it("leaves out a skill for working on the repository", async () => {
    await aSkill("skills/zitadel", "name: zitadel");
    await aSkill(
      "apps/website/skills/zitadel-changelog-entries",
      "name: zitadel-changelog-entries\nmetadata:\n  internal: true",
    );

    const skills = await publicSkills(repo);

    expect(skills.map((skill) => skill.name)).toEqual(["zitadel"]);
  });

  it("refuses a skill not named after its folder", async () => {
    await aSkill("skills/zitadel", "name: zitadel-router");

    await expect(publicSkills(repo)).rejects.toThrow("not after its folder");
  });

  it("refuses two skills of one name", async () => {
    await aSkill("skills/zitadel", "name: zitadel");
    await aSkill("packages/sdk-next/skills/zitadel", "name: zitadel");

    await expect(publicSkills(repo)).rejects.toThrow("are both named zitadel");
  });
});

describe("bundleSkills", () => {
  it("copies each skill with the files it references", async () => {
    await aSkill("apps/cli/skills/zitadel-cli", "name: zitadel-cli", [
      "references/driving-login-ui.md",
    ]);

    await bundleSkills(repo, out);

    expect(existsSync(join(out, "zitadel-cli/references/driving-login-ui.md"))).toBe(true);
  });

  it("drops a skill an earlier build bundled that is gone", async () => {
    await aSkill("skills/zitadel", "name: zitadel");
    await mkdir(join(out, "zitadel-removed"), { recursive: true });

    await bundleSkills(repo, out);

    expect(await readdir(out)).toEqual(["zitadel"]);
  });
});
