import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rosie = vi.hoisted(() => ({ agents: vi.fn() }));
const box = vi.hoisted(() => vi.fn());

vi.mock("rosie-skills", () => rosie);
vi.mock("consola", () => ({ default: { box } }));

import { showSkillsHint } from "../../../src/lib/skills-hint";

const CLAUDE = { name: "claude", display: "Claude Code", detected: true, installPath: "/x" };

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
  it("names the detected agents and the command to run, without running anything", async () => {
    await showSkillsHint({ env, interactive: true });

    const message = box.mock.calls[0]?.[0].message as string;
    expect(message).toContain("Claude Code");
    expect(message).toContain("npx skills add zitadel/nextgen --full-depth");
  });

  it("shows once", async () => {
    await showSkillsHint({ env, interactive: true });
    await showSkillsHint({ env, interactive: true });

    expect(box).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["is not interactive", { interactive: false }],
    ["runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["has NO_SKILLS_PROMPT set", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])(
    "stays silent when it %s",
    async (_name, { interactive, extra }: { interactive: boolean; extra?: NodeJS.ProcessEnv }) => {
      await showSkillsHint({ env: { ...env, ...extra }, interactive });

      expect(box).not.toHaveBeenCalled();
      expect(existsSync(shownFile())).toBe(false);
    },
  );

  it("stays silent when no coding agent is detected", async () => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    await showSkillsHint({ env, interactive: true });

    expect(box).not.toHaveBeenCalled();
  });

  it("never throws into the command", async () => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    await expect(showSkillsHint({ env, interactive: true })).resolves.toBeUndefined();
  });
});
