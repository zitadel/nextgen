import { describe, expect, it } from "vitest";

import { COMMANDS } from "../../../../src/index";
import { BaseCommand } from "../../../../src/lib/oclif/base";
import {
  environmentFlags,
  environmentSelectorSuffix,
  projectEnvFile,
} from "../../../../src/lib/oclif/environment-flags";
import { parseFlag } from "../../../helpers/inputs";

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

  it("show --credential exactly where it is the flag every connecting command shares", () => {
    const shown = Object.values(COMMANDS).flatMap((command) => {
      const credential = (command.baseFlags as Record<string, { hidden?: boolean }>).credential;
      return credential === undefined || credential.hidden ? [] : [credential];
    });

    expect(shown.length).toBeGreaterThan(0);
    for (const credential of shown) {
      expect(credential).toBe(environmentFlags.credential);
    }
  });

  it("let every command a selector is appended to parse --credential", () => {
    // A suggestion carries the run's --credential, so whatever it names must
    // take it, hidden where the command never connects with it.
    const missing = Object.entries(COMMANDS)
      .filter(([, command]) => "env" in command.baseFlags || "env" in (command.flags ?? {}))
      .filter(
        ([, command]) =>
          !("credential" in command.baseFlags || "credential" in (command.flags ?? {})),
      )
      .map(([id]) => id);

    expect(missing).toEqual([]);
  });

  it.each(["login", "whoami", "logout", "env", "env:list", "claim", "preview", "doctor"])(
    "hide --credential on %s, which never connects with a credential the run chooses",
    (id) => {
      const command = COMMANDS[id];
      const flags = { ...command?.baseFlags, ...command?.flags } as Record<
        string,
        { hidden?: boolean }
      >;

      expect(flags.credential?.hidden).toBe(true);
    },
  );

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

describe("--env", () => {
  it("takes the name a shell padded with spaces, as the argument does", async () => {
    await expect(parseFlag(environmentFlags.env, " production ", "env")).resolves.toBe(
      "production",
    );
  });

  it("refuses a name no .env.<name>.local file can be called", async () => {
    await expect(parseFlag(environmentFlags.env, "../escape", "env")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: '"../escape" is not a usable environment name',
    });
  });
});

describe("--credential", () => {
  it("takes the project secret or your sign-in, and nothing else", () => {
    expect(environmentFlags.credential.options).toEqual(["project", "login"]);
  });
});

describe("environmentSelectorSuffix", () => {
  it("is empty for a run that named nothing", () => {
    expect(environmentSelectorSuffix({})).toBe("");
  });

  it("carries --credential beside the environment", () => {
    expect(environmentSelectorSuffix({ envName: "staging", credential: "project" })).toBe(
      " --env staging --credential project",
    );
  });

  it("keeps --cwd and --env-file as typed", () => {
    expect(environmentSelectorSuffix({ cwd: "apps/web", envFile: "apps/web/.env.prod" })).toBe(
      " --env-file apps/web/.env.prod --cwd apps/web",
    );
  });

  it("quotes a value the shell would split", () => {
    expect(environmentSelectorSuffix({ cwd: "my app" })).toBe(" --cwd 'my app'");
  });

  it.each([
    ["an environment name", { envName: "--force" }, " --env=--force"],
    ["an env file", { envFile: "--force" }, " --env-file=--force"],
    ["a server", { server: "--force" }, " --server=--force"],
    ["a directory", { cwd: "--force" }, " --cwd=--force"],
  ])("joins a dash-prefixed %s to its flag, so the retry parses", (_name, input, expected) => {
    expect(environmentSelectorSuffix(input)).toBe(expected);
  });
});

describe("projectEnvFile", () => {
  it("names a project file as it is for a run in the project", () => {
    expect(projectEnvFile(undefined, ".env.development.local")).toBe(".env.development.local");
  });

  it("puts --cwd in front, since Node reads --env-file from the shell's directory", () => {
    expect(projectEnvFile("shop", ".env.development.local")).toBe("shop/.env.development.local");
  });

  it("keeps an absolute --cwd absolute", () => {
    expect(projectEnvFile("/work/shop/", ".env.production.local")).toBe(
      "/work/shop/.env.production.local",
    );
  });
});
