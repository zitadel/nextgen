import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

const rosie = vi.hoisted(() => ({ agents: vi.fn() }));
const log = vi.hoisted(() => vi.fn());
const homedir = vi.hoisted(() => vi.fn<() => string>());

vi.mock("rosie-skills", () => rosie);
vi.mock("consola", () => ({ default: { log } }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir };
});

import { showSkillsHint } from "@/lib/skills-hint";

const CLAUDE = { name: "claude", display: "Claude Code", detected: true, installPath: "/x" };
const cliVersion = "1.2.3";

/** The environment of a user whose config home is `dir`. */
const envIn = (dir: string): NodeJS.ProcessEnv => ({ XDG_CONFIG_HOME: dir });

beforeEach(() => {
  rosie.agents.mockResolvedValue([CLAUDE]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const shownFile = (dir: string) => join(dir, "zitadel", "cli", "skills-hint.json");

describe("showSkillsHint", () => {
  it("names the command to run and that it is optional, without running anything", async ({
    dir,
  }) => {
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    const message = log.mock.calls[0]?.[0] as string;
    expect(message).toContain("Using an AI coding agent?");
    expect(message).toContain("npx @zitadel/cli@1.2.3 skills add");
    expect(message).toContain("Optional. You can continue without installing skills.");
  });

  it("does not name the agents it detected or mention the opt-out variable", async ({ dir }) => {
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    const message = log.mock.calls[0]?.[0] as string;
    expect(message).not.toContain("Claude Code");
    expect(message).not.toContain("detected");
    expect(message).not.toContain("NO_SKILLS_PROMPT");
  });

  it("is not counted as shown when showing it fails", async ({ dir }) => {
    log.mockImplementationOnce(() => {
      throw new Error("closed stream");
    });

    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    expect(log).toHaveBeenCalledTimes(2);
    expect(existsSync(shownFile(dir))).toBe(true);
  });

  it("shows once", async ({ dir }) => {
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    expect(log).toHaveBeenCalledTimes(1);
  });

  it.for<[string, { interactive: boolean; extra?: NodeJS.ProcessEnv }]>([
    ["is not interactive", { interactive: false }],
    ["runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["has NO_SKILLS_PROMPT set", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])("stays silent when it %s", async ([_name, { interactive, extra }], { dir }) => {
    await showSkillsHint({ env: { ...envIn(dir), ...extra }, interactive, cliVersion });

    expect(log).not.toHaveBeenCalled();
    expect(existsSync(shownFile(dir))).toBe(false);
  });

  it("stays silent when no coding agent is detected", async ({ dir }) => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    await showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });

    expect(log).not.toHaveBeenCalled();
  });

  it("shows once even when two first runs race for the marker", async ({ dir }) => {
    const first = showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    const second = showSkillsHint({ env: envIn(dir), interactive: true, cliVersion });
    await Promise.all([first, second]);

    expect(log).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the home directory cannot be determined", async () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    await showSkillsHint({ env: {}, interactive: true, cliVersion });

    expect(log).not.toHaveBeenCalled();
  });

  it("never throws into the command", async ({ dir }) => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    await expect(
      showSkillsHint({ env: envIn(dir), interactive: true, cliVersion }),
    ).resolves.toBeUndefined();
  });
});
