import { describe, expect, it } from "vitest";

import { COMMANDS } from "../../../../src/index";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import {
  environmentFlags,
  environmentSelectorSuffix,
} from "../../../../src/lib/oclif/environment-flags";

/** `[name, char]` for every flag in a bag. */
const entries = (bag: Record<string, { char?: string }>): Array<[string, string | undefined]> =>
  Object.entries(bag).map(([name, flag]) => [name, flag.char]);

/** What two bags have in common by name or by short form, spelled out for the failure message. */
function clashes(
  first: Record<string, { char?: string }>,
  second: Record<string, { char?: string }>,
): string[] {
  const found: string[] = [];
  for (const [name, char] of entries(first)) {
    for (const [otherName, otherChar] of entries(second)) {
      if (name === otherName) {
        found.push(`--${name} is declared twice`);
      } else if (char !== undefined && char === otherChar) {
        found.push(`-${char} is shared by --${name} and --${otherName}`);
      }
    }
  }
  return found;
}

describe("the flag bags", () => {
  it("do not clash with the flags every command has", () => {
    expect(clashes(BaseCommand.baseFlags, environmentFlags)).toEqual([]);
  });

  it("are the same flags on every command that takes them", () => {
    // Hidden copies sit on the `auth-method` commands that only edit files and
    // resolve no environment; they exist so those commands share a base class
    // with the one that does, and `--env` means nothing to them.
    const takers = Object.values(COMMANDS).filter(
      (command) => "env" in command.baseFlags && !command.baseFlags.env.hidden,
    );

    expect(takers.length).toBeGreaterThan(0);
    for (const command of takers) {
      expect(command.baseFlags.env).toBe(environmentFlags.env);
      expect(command.baseFlags["env-file"]).toBe(environmentFlags["env-file"]);
    }
  });

  it("leave no command declaring a flag name or short form twice", () => {
    // `baseFlags` and `flags` are spread into one object by oclif, so a repeat
    // would silently replace the earlier flag rather than fail.
    for (const [id, command] of Object.entries(COMMANDS)) {
      expect(clashes(command.baseFlags, command.flags ?? {}), id).toEqual([]);
      const chars = [...entries(command.baseFlags), ...entries(command.flags ?? {})]
        .map(([, char]) => char)
        .filter((char) => char !== undefined);
      expect(new Set(chars).size, `${id} reuses a short form`).toBe(chars.length);
    }
  });
});

describe("clashes", () => {
  it("fails on a repeated name", () => {
    expect(clashes({ env: {} }, { env: {} })).toEqual(["--env is declared twice"]);
  });

  it("fails on a repeated short form", () => {
    expect(clashes({ env: { char: "e" } }, { extra: { char: "e" } })).toEqual([
      "-e is shared by --env and --extra",
    ]);
  });
});

describe("environmentSelectorSuffix", () => {
  it("is empty for a run that named nothing", () => {
    expect(environmentSelectorSuffix({})).toBe("");
  });

  it("keeps --cwd, which --env-file resolves against", () => {
    expect(environmentSelectorSuffix({ cwd: "apps/web", envFile: ".env.prod" })).toBe(
      " --env-file .env.prod --cwd apps/web",
    );
  });

  it("quotes a value the shell would split", () => {
    expect(environmentSelectorSuffix({ cwd: "my app" })).toBe(" --cwd 'my app'");
  });
});
