import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rosie = vi.hoisted(() => ({ agents: vi.fn() }));
const log = vi.hoisted(() => vi.fn());

vi.mock("rosie-skills", () => rosie);
vi.mock("consola", () => ({ default: { log } }));

import { claimSkills, eligibleForSkills, showSkillsHint } from "../../../src/lib/skills-hint";

const CLAUDE = { name: "claude", display: "Claude Code", detected: true, installPath: "/x" };
const cliVersion = "1.2.3";

let config: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), "zitadel-skills-"));
  env = { XDG_CONFIG_HOME: config };
  rosie.agents.mockResolvedValue([CLAUDE]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const shownFile = () => join(config, "zitadel", "cli", "skills-hint.json");

describe("showSkillsHint", () => {
  it("names the command to run and that it is optional, without running anything", async () => {
    await showSkillsHint({ env, interactive: true, cliVersion });

    const message = log.mock.calls[0]?.[0] as string;
    expect(message).toContain("Using an AI coding agent?");
    expect(message).toContain("npx @zitadel/cli@1.2.3 skills add");
    expect(message).toContain("Optional. You can continue without installing skills.");
  });

  it("does not name the agents it detected or mention the opt-out variable", async () => {
    await showSkillsHint({ env, interactive: true, cliVersion });

    const message = log.mock.calls[0]?.[0] as string;
    expect(message).not.toContain("Claude Code");
    expect(message).not.toContain("detected");
    expect(message).not.toContain("NO_SKILLS_PROMPT");
  });

  it("is not counted as shown when showing it fails", async () => {
    log.mockImplementationOnce(() => {
      throw new Error("closed stream");
    });

    await showSkillsHint({ env, interactive: true, cliVersion });
    await showSkillsHint({ env, interactive: true, cliVersion });

    expect(log).toHaveBeenCalledTimes(2);
    expect(existsSync(shownFile())).toBe(true);
  });

  it("shows once", async () => {
    await showSkillsHint({ env, interactive: true, cliVersion });
    await showSkillsHint({ env, interactive: true, cliVersion });

    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["is not interactive", { interactive: false }],
    ["runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["has NO_SKILLS_PROMPT set", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])(
    "stays silent when it %s",
    async (_name, { interactive, extra }: { interactive: boolean; extra?: NodeJS.ProcessEnv }) => {
      await showSkillsHint({ env: { ...env, ...extra }, interactive, cliVersion });

      expect(log).not.toHaveBeenCalled();
      expect(existsSync(shownFile())).toBe(false);
    },
  );

  it("stays silent when no coding agent is detected", async () => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    await showSkillsHint({ env, interactive: true, cliVersion });

    expect(log).not.toHaveBeenCalled();
  });

  it("shows once even when two first runs race for the marker", async () => {
    const first = showSkillsHint({ env, interactive: true, cliVersion });
    const second = showSkillsHint({ env, interactive: true, cliVersion });
    await Promise.all([first, second]);

    expect(log).toHaveBeenCalledTimes(1);
  });

  it("never throws into the command", async () => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    await expect(showSkillsHint({ env, interactive: true, cliVersion })).resolves.toBeUndefined();
  });
});

describe("eligibleForSkills", () => {
  it("offers the skills when someone is watching and an agent is installed", async () => {
    expect(await eligibleForSkills({ env, interactive: true, cliVersion })).toBe(true);
  });

  it.each([
    ["nobody is watching", { interactive: false }],
    ["it runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["the offer is declined", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])(
    "offers nothing when %s",
    async (_name, { interactive, extra }: { interactive: boolean; extra?: NodeJS.ProcessEnv }) => {
      expect(await eligibleForSkills({ env: { ...env, ...extra }, interactive, cliVersion })).toBe(
        false,
      );
    },
  );

  it("offers nothing when no coding agent is installed", async () => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    expect(await eligibleForSkills({ env, interactive: true, cliVersion })).toBe(false);
  });

  it("offers nothing once the offer has been spent", async () => {
    claimSkills(env, cliVersion);

    expect(await eligibleForSkills({ env, interactive: true, cliVersion })).toBe(false);
  });

  it("never throws into the command", async () => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    expect(await eligibleForSkills({ env, interactive: true, cliVersion })).toBe(false);
  });
});

describe("claimSkills", () => {
  it("names the CLI's own command at the version that is running", () => {
    // The skills ship inside the CLI, so the step adds the ones this release
    // carries rather than fetching a repository's.
    expect(claimSkills(env, cliVersion)?.command).toBe("npx @zitadel/cli@1.2.3 skills add");
  });

  it("says what the step is for without naming the agent it found", () => {
    const step = claimSkills(env, cliVersion);

    expect(step?.text).toContain("Using an AI coding agent?");
    expect(step?.text).not.toContain("Claude Code");
  });

  it("spends the offer, so a second run has nothing to add to its summary", () => {
    expect(claimSkills(env, cliVersion)).toBeDefined();

    expect(claimSkills(env, cliVersion)).toBeUndefined();
  });

  it("records the offer where a second project on the machine will see it", () => {
    claimSkills(env, cliVersion);

    expect(existsSync(shownFile())).toBe(true);
  });
});
