import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { bundleSkills, publicSkills } from "@/lib/skills/bundle";

async function aSkill(
  repo: string,
  path: string,
  frontmatter: string,
  files: string[] = [],
): Promise<void> {
  const dir = join(repo, path);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Skill\n`);
  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), "reference\n");
  }
}

describe("publicSkills", () => {
  it("finds the skills of the root, the apps and the packages", async ({ dir: repo }) => {
    await aSkill(repo, "skills/zitadel", "name: zitadel");
    await aSkill(repo, "apps/cli/skills/zitadel-cli", "name: zitadel-cli");
    await aSkill(repo, "packages/sdk-next/skills/zitadel-sdk-next", "name: zitadel-sdk-next");

    const skills = await publicSkills(repo);

    expect(skills.map((skill) => skill.name)).toEqual([
      "zitadel",
      "zitadel-cli",
      "zitadel-sdk-next",
    ]);
  });

  it("leaves out a skill for working on the repository", async ({ dir: repo }) => {
    await aSkill(repo, "skills/zitadel", "name: zitadel");
    await aSkill(
      repo,
      "apps/website/skills/zitadel-changelog-entries",
      "name: zitadel-changelog-entries\nmetadata:\n  internal: true",
    );

    const skills = await publicSkills(repo);

    expect(skills.map((skill) => skill.name)).toEqual(["zitadel"]);
  });

  it("refuses a skill not named after its folder", async ({ dir: repo }) => {
    await aSkill(repo, "skills/zitadel", "name: zitadel-router");

    await expect(publicSkills(repo)).rejects.toThrow("not after its folder");
  });

  it("refuses two skills of one name", async ({ dir: repo }) => {
    await aSkill(repo, "skills/zitadel", "name: zitadel");
    await aSkill(repo, "packages/sdk-next/skills/zitadel", "name: zitadel");

    await expect(publicSkills(repo)).rejects.toThrow("are both named zitadel");
  });
});

describe("the repository's public skills", () => {
  const root = join(import.meta.dirname, "../../../../../..");

  /** The paths LICENSING.md lists under its MIT exceptions, as patterns. */
  async function mitPaths(): Promise<RegExp[]> {
    const licensing = await readFile(join(root, "LICENSING.md"), "utf8");
    const list = /## MIT exceptions[\s\S]*?```text\n([\s\S]*?)```/.exec(licensing)?.[1] ?? "";
    return list
      .split("\n")
      .filter((path) => path.endsWith("/"))
      .map((path) => new RegExp(`^${path.replaceAll(".", "\\.").replaceAll("*", "[^/]*")}`));
  }

  it("are all under an MIT path, as the MIT package that ships them is", async () => {
    const mit = await mitPaths();

    const skills = await publicSkills(root);

    const elsewhere = skills
      .map((skill) => `${relative(root, skill.dir)}/`)
      .filter((dir) => !mit.some((path) => path.test(dir)));
    expect(elsewhere).toEqual([]);
  });
});

describe("bundleSkills", () => {
  it("copies each skill with the files it references", async ({ dir: repo, other: out }) => {
    await aSkill(repo, "apps/cli/skills/zitadel-cli", "name: zitadel-cli", [
      "references/driving-login-ui.md",
    ]);

    await bundleSkills(repo, out);

    expect(existsSync(join(out, "zitadel-cli/references/driving-login-ui.md"))).toBe(true);
  });

  it("drops a skill an earlier build bundled that is gone", async ({ dir: repo, other: out }) => {
    await aSkill(repo, "skills/zitadel", "name: zitadel");
    await mkdir(join(out, "zitadel-removed"), { recursive: true });

    await bundleSkills(repo, out);

    expect(await readdir(out)).toEqual(["zitadel"]);
  });
});
