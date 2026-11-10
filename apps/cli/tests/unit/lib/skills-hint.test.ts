import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

const rosie = vi.hoisted(() => ({ agents: vi.fn() }));
const homedir = vi.hoisted(() => vi.fn<() => string>());

vi.mock("rosie-skills", () => rosie);
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir };
});

import { installLogSink } from "@/lib/log";
import { recordLog } from "@tests/helpers/log";
import { claimSkills, eligibleForSkills, showSkillsHint } from "@/lib/skills-hint";

const CLAUDE = { name: "claude", display: "Claude Code", detected: true, installPath: "/x" };
const cliVersion = "1.2.3";

/** The environment of a user whose config home is `dir`. */
const envIn = (dir: string): NodeJS.ProcessEnv => ({ XDG_CONFIG_HOME: dir });

let recorded = recordLog();
const said = (): string[] => recorded.said.map((line) => line.text);

beforeEach(() => {
  rosie.agents.mockResolvedValue([CLAUDE]);
  recorded = recordLog();
});

afterEach(() => {
  recorded.stop();
  vi.clearAllMocks();
});

const shownFile = (dir: string) => join(dir, "zitadel", "cli", "skills-hint.json");

describe("showSkillsHint", () => {
  it("names the command to run and that it is optional, without running anything", async ({
    dir,
  }) => {
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    const message = said()[0] ?? "";
    expect(message).toContain("Using an AI coding agent?");
    expect(message).toContain("npx @zitadel/cli@1.2.3 skills add");
    expect(message).toContain("Optional. You can continue without installing skills.");
  });

  it("does not name the agents it detected or mention the opt-out variable", async ({ dir }) => {
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    const message = said()[0] ?? "";
    expect(message).not.toContain("Claude Code");
    expect(message).not.toContain("detected");
    expect(message).not.toContain("NO_SKILLS_PROMPT");
  });

  it("is not counted as shown when showing it fails", async ({ dir }) => {
    recorded.stop();
    let first = true;
    const calls: string[] = [];
    const stop = installLogSink((_level, text) => {
      calls.push(text);
      if (first) {
        first = false;
        throw new Error("closed stream");
      }
    });

    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    stop();
    expect(calls).toHaveLength(2);
    expect(existsSync(shownFile(dir))).toBe(true);
  });

  it("shows once", async ({ dir }) => {
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    expect(said()).toHaveLength(1);
  });

  it.for<[string, { interactive: boolean; extra?: NodeJS.ProcessEnv }]>([
    ["is not interactive", { interactive: false }],
    ["runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["has NO_SKILLS_PROMPT set", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])("stays silent when it %s", async ([_name, { interactive, extra }], { dir }) => {
    await showSkillsHint({ env: { ...envIn(dir), ...extra }, interactive, cliVersion });

    expect(said()).toEqual([]);
    expect(existsSync(shownFile(dir))).toBe(false);
  });

  it("stays silent when no coding agent is detected", async ({ dir }) => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    expect(said()).toEqual([]);
  });

  it("shows once even when two first runs race for the marker", async ({ dir }) => {
    const first = showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    const second = showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    await Promise.all([first, second]);

    expect(said()).toHaveLength(1);
  });

  it("stays silent when the home directory cannot be determined", async () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    await showSkillsHint({ env: {}, interactive: true, cliVersion });

    expect(said()).toEqual([]);
  });

  it("never throws into the command", async ({ dir }) => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    await expect(
      showSkillsHint({ env: envIn(dir), interactive: true, cliVersion }),
    ).resolves.toBeUndefined();
  });
});

describe("eligibleForSkills", () => {
  it("offers the skills when someone is watching and an agent is installed", async ({ dir }) => {
    expect(await eligibleForSkills({ env: envIn(dir), interactive: true, cliVersion })).toBe(true);
  });

  it.for<[string, { interactive: boolean; extra?: NodeJS.ProcessEnv }]>([
    ["nobody is watching", { interactive: false }],
    ["it runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["the offer is declined", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])("offers nothing when %s", async ([_name, { interactive, extra }], { dir }) => {
    expect(
      await eligibleForSkills({ env: { ...envIn(dir), ...extra }, interactive, cliVersion }),
    ).toBe(false);
  });

  it("offers nothing when no coding agent is installed", async ({ dir }) => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    expect(await eligibleForSkills({ env: envIn(dir), interactive: true, cliVersion })).toBe(false);
  });

  it("offers nothing once the offer has been spent", async ({ dir }) => {
    claimSkills(envIn(dir), cliVersion);

    expect(await eligibleForSkills({ env: envIn(dir), interactive: true, cliVersion })).toBe(false);
  });

  it("offers nothing on a machine with no config directory to record it in", async () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    expect(await eligibleForSkills({ env: {}, interactive: true, cliVersion })).toBe(false);
  });

  it("never throws into the command", async ({ dir }) => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    expect(await eligibleForSkills({ env: envIn(dir), interactive: true, cliVersion })).toBe(false);
  });
});

// Both ways of offering the skills decide through one function, so what makes
// one silent makes the other silent. They once had two copies of the rule, and
// a guard added to one was missing from the other.
describe("the two ways of offering the skills", () => {
  it.each([
    ["in CI", { CI: "1" }, true],
    ["when opted out", { NO_SKILLS_PROMPT: "1" }, true],
    ["when nobody is watching", {}, false],
  ])("agree they have nothing to offer %s", async (_when, extra, interactive) => {
    const dir = (await import("node:fs")).mkdtempSync(
      join((await import("node:os")).tmpdir(), "zitadel-skills-agree-"),
    );
    const env = { ...envIn(dir), ...extra };

    await showSkillsHint({ env, interactive, cliVersion });

    expect(said()).toEqual([]);
    expect(await eligibleForSkills({ env, interactive, cliVersion })).toBe(false);
  });
});

describe("claimSkills", () => {
  it("names the CLI's own command at the version that is running", ({ dir }) => {
    // The skills ship inside the CLI, so the step adds the ones this release
    // carries rather than fetching a repository's.
    expect(claimSkills(envIn(dir), cliVersion)?.command).toBe("npx @zitadel/cli@1.2.3 skills add");
  });

  it("says what the step is for without naming the agent it found", ({ dir }) => {
    const step = claimSkills(envIn(dir), cliVersion);

    expect(step?.text).toContain("Using an AI coding agent?");
    expect(step?.text).not.toContain("Claude Code");
  });

  it("spends the offer, so a second run has nothing to add to its summary", ({ dir }) => {
    expect(claimSkills(envIn(dir), cliVersion)).toBeDefined();

    expect(claimSkills(envIn(dir), cliVersion)).toBeUndefined();
  });

  it("records the offer where a second project on the machine will see it", ({ dir }) => {
    claimSkills(envIn(dir), cliVersion);

    expect(existsSync(shownFile(dir))).toBe(true);
  });

  it("claims nothing on a machine with no config directory to record it in", () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    expect(claimSkills({}, cliVersion)).toBeUndefined();
  });
});
