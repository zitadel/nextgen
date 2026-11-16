import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { recording } from "@tests/fixtures";

const rosie = vi.hoisted(() => ({ agents: vi.fn() }));
const homedir = vi.hoisted(() => vi.fn<() => string>());

vi.mock("rosie-skills", () => rosie);
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir };
});

import { log } from "@/lib/ui";
import { Skills } from "@/lib/skills";
import { aSuggest } from "@tests/helpers/suggestions";

const CLAUDE = { name: "claude", display: "Claude Code", detected: true, installPath: "/x" };
/** The `skills add` the hint names, as a run renders it. */
const skillsAdd = aSuggest({}, "1.2.3")({ id: "skills:add" });

/** The environment of a user whose config home is `dir`. */
const envIn = (dir: string): NodeJS.ProcessEnv => ({ XDG_CONFIG_HOME: dir });

/** `it` with what was said through `log`, which every test records. */
const it = recording.extend<{ said: () => string[] }>({
  said: ({ recorded }, use) => {
    return use(() => {
      return recorded.said.map((line) => {
        return line.text;
      });
    });
  },
});

beforeEach(() => {
  rosie.agents.mockResolvedValue([CLAUDE]);
});

afterEach(() => {
  vi.clearAllMocks();
});

const shownFile = (dir: string) => join(dir, "zitadel", "cli", "skills-hint.json");

describe("Skills.showHint", () => {
  it("names the command to run and that it is optional, without running anything", async ({
    dir,
    said,
  }) => {
    await new Skills(envIn(dir), true).showHint(skillsAdd);

    const message = said()[0] ?? "";
    expect(message).toContain("Using an AI coding agent?");
    expect(message).toContain("npx @zitadel/cli@1.2.3 skills add");
    expect(message).toContain("Optional. You can continue without installing skills.");
  });

  it("does not name the agents it detected or mention the opt-out variable", async ({
    dir,
    said,
  }) => {
    await new Skills(envIn(dir), true).showHint(skillsAdd);

    const message = said()[0] ?? "";
    expect(message).not.toContain("Claude Code");
    expect(message).not.toContain("detected");
    expect(message).not.toContain("NO_SKILLS_PROMPT");
  });

  it("is not counted as shown when showing it fails", async ({ dir, recorded }) => {
    recorded.stop();
    const calls: string[] = [];
    const stop = log.install((_level, text) => {
      calls.push(text);
      if (calls.length === 1) {
        throw new Error("closed stream");
      }
    });

    await new Skills(envIn(dir), true).showHint(skillsAdd);
    await new Skills(envIn(dir), true).showHint(skillsAdd);

    stop();
    expect(calls).toHaveLength(2);
    expect(existsSync(shownFile(dir))).toBe(true);
  });

  it("shows once", async ({ dir, said }) => {
    await new Skills(envIn(dir), true).showHint(skillsAdd);
    await new Skills(envIn(dir), true).showHint(skillsAdd);

    expect(said()).toHaveLength(1);
  });

  it.for<[string, { interactive: boolean; extra?: NodeJS.ProcessEnv }]>([
    ["is not interactive", { interactive: false }],
    ["runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["has NO_SKILLS_PROMPT set", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])("stays silent when it %s", async ([_name, { interactive, extra }], { dir, said }) => {
    await new Skills({ ...envIn(dir), ...extra }, interactive).showHint(skillsAdd);

    expect(said()).toEqual([]);
    expect(existsSync(shownFile(dir))).toBe(false);
  });

  it("stays silent when no coding agent is detected", async ({ dir, said }) => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    await new Skills(envIn(dir), true).showHint(skillsAdd);

    expect(said()).toEqual([]);
  });

  it("shows once even when two first runs race for the marker", async ({ dir, said }) => {
    const first = new Skills(envIn(dir), true).showHint(skillsAdd);
    const second = new Skills(envIn(dir), true).showHint(skillsAdd);
    await Promise.all([first, second]);

    expect(said()).toHaveLength(1);
  });

  it("stays silent when the home directory cannot be determined", async ({ said }) => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    await new Skills({}, true).showHint(skillsAdd);

    expect(said()).toEqual([]);
  });

  it("never throws into the command", async ({ dir }) => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    await expect(new Skills(envIn(dir), true).showHint(skillsAdd)).resolves.toBeUndefined();
  });
});

describe("Skills.eligible", () => {
  it("offers the skills when someone is watching and an agent is installed", async ({ dir }) => {
    expect(await new Skills(envIn(dir), true).eligible()).toBe(true);
  });

  it.for<[string, { interactive: boolean; extra?: NodeJS.ProcessEnv }]>([
    ["nobody is watching", { interactive: false }],
    ["it runs in CI", { interactive: true, extra: { CI: "true" } }],
    ["the offer is declined", { interactive: true, extra: { NO_SKILLS_PROMPT: "1" } }],
  ])("offers nothing when %s", async ([_name, { interactive, extra }], { dir }) => {
    expect(await new Skills({ ...envIn(dir), ...extra }, interactive).eligible()).toBe(false);
  });

  it("offers nothing when no coding agent is installed", async ({ dir }) => {
    rosie.agents.mockResolvedValue([{ ...CLAUDE, detected: false }]);

    expect(await new Skills(envIn(dir), true).eligible()).toBe(false);
  });

  it("offers nothing once the offer has been spent", async ({ dir }) => {
    new Skills(envIn(dir), true).claim(skillsAdd);

    expect(await new Skills(envIn(dir), true).eligible()).toBe(false);
  });

  it("offers nothing on a machine with no config directory to record it in", async () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    expect(await new Skills({}, true).eligible()).toBe(false);
  });

  it("never throws into the command", async ({ dir }) => {
    rosie.agents.mockRejectedValue(new Error("boom"));

    expect(await new Skills(envIn(dir), true).eligible()).toBe(false);
  });
});

// Both ways of offering the skills decide through one function, so what makes
// one silent makes the other silent. They once had two copies of the rule, and
// a guard added to one was missing from the other.
describe("the two ways of offering the skills", () => {
  it.for<[string, NodeJS.ProcessEnv, boolean]>([
    ["in CI", { CI: "1" }, true],
    ["when opted out", { NO_SKILLS_PROMPT: "1" }, true],
    ["when nobody is watching", {}, false],
  ])("agree they have nothing to offer %s", async ([_when, extra, interactive], { dir, said }) => {
    const env = { ...envIn(dir), ...extra };

    await new Skills(env, interactive).showHint(skillsAdd);

    expect(said()).toEqual([]);
    expect(await new Skills(env, interactive).eligible()).toBe(false);
  });
});

describe("Skills.claim", () => {
  it("names the CLI's own command at the version that is running", ({ dir }) => {
    // The skills ship inside the CLI, so the step adds the ones this release
    // carries rather than fetching a repository's.
    expect(new Skills(envIn(dir), true).claim(skillsAdd)?.command).toBe(
      "npx @zitadel/cli@1.2.3 skills add",
    );
  });

  it("says what the step is for without naming the agent it found", ({ dir }) => {
    const step = new Skills(envIn(dir), true).claim(skillsAdd);

    expect(step?.text).toContain("Using an AI coding agent?");
    expect(step?.text).not.toContain("Claude Code");
  });

  it("spends the offer, so a second run has nothing to add to its summary", ({ dir }) => {
    expect(new Skills(envIn(dir), true).claim(skillsAdd)).toBeDefined();

    expect(new Skills(envIn(dir), true).claim(skillsAdd)).toBeUndefined();
  });

  it("records the offer where a second project on the machine will see it", ({ dir }) => {
    new Skills(envIn(dir), true).claim(skillsAdd);

    expect(existsSync(shownFile(dir))).toBe(true);
  });

  it("claims nothing on a machine with no config directory to record it in", () => {
    homedir.mockImplementation(() => {
      throw new Error("no home directory");
    });

    expect(new Skills({}, true).claim(skillsAdd)).toBeUndefined();
  });
});
