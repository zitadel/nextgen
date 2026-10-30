import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rosie = vi.hoisted(() => ({ agents: vi.fn() }));

vi.mock("rosie-skills", () => rosie);

import { addSkills, bundledSkills, skillDirs } from "../../../../src/lib/skills/add";

const CLAUDE = { name: "claude", display: "Claude Code", detected: true, installPath: "/x" };

let packageRoot: string;
let project: string;

beforeEach(async () => {
  packageRoot = await mkdtemp(join(tmpdir(), "zitadel-cli-package-"));
  project = await mkdtemp(join(tmpdir(), "zitadel-skills-project-"));
  await mkdir(join(packageRoot, "dist/skills/zitadel-cli/references"), { recursive: true });
  await writeFile(join(packageRoot, "dist/skills/zitadel-cli/SKILL.md"), "this version\n");
  await mkdir(join(packageRoot, "dist/skills/zitadel"), { recursive: true });
  await writeFile(join(packageRoot, "dist/skills/zitadel/SKILL.md"), "router\n");
  rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false, installPath: null }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("bundledSkills", () => {
  it("names the skills the package carries", async () => {
    expect(await bundledSkills(packageRoot)).toEqual(["zitadel", "zitadel-cli"]);
  });
});

describe("skillDirs", () => {
  it("adds to the folder most agents read when Claude Code is nowhere", async () => {
    expect(await skillDirs(project)).toEqual([".agents/skills"]);
  });

  it("adds to Claude Code's folder too when Claude Code is installed", async () => {
    rosie.agents.mockResolvedValue([CLAUDE]);

    expect(await skillDirs(project)).toEqual([".agents/skills", ".claude/skills"]);
  });

  it("still adds to the folder most agents read when agent detection fails", async () => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    expect(await skillDirs(project)).toEqual([".agents/skills"]);
  });

  it("adds to Claude Code's folder too when the project has one", async () => {
    await mkdir(join(project, ".claude"));

    expect(await skillDirs(project)).toEqual([".agents/skills", ".claude/skills"]);
  });
});

describe("addSkills", () => {
  it("replaces an older version's copy, files it no longer has included", async () => {
    await mkdir(join(project, ".agents/skills/zitadel-cli"), { recursive: true });
    await writeFile(join(project, ".agents/skills/zitadel-cli/old.md"), "gone\n");

    await addSkills({
      packageRoot,
      projectDir: project,
      skills: ["zitadel-cli"],
      dirs: [".agents/skills"],
    });

    expect(existsSync(join(project, ".agents/skills/zitadel-cli/old.md"))).toBe(false);
  });

  it("replaces a link to another copy without touching what it points at", async () => {
    const elsewhere = join(project, "elsewhere");
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, "SKILL.md"), "someone else's\n");
    await mkdir(join(project, ".claude/skills"), { recursive: true });
    await symlink(elsewhere, join(project, ".claude/skills/zitadel-cli"));

    await addSkills({
      packageRoot,
      projectDir: project,
      skills: ["zitadel-cli"],
      dirs: [".claude/skills"],
    });

    expect(await readFile(join(elsewhere, "SKILL.md"), "utf8")).toBe("someone else's\n");
  });
});
