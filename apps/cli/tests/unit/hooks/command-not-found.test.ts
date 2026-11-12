import { describe, expect, it } from "vitest";

import { Invocation, UnknownCommand } from "@/hooks/command-not-found";

const KNOWN: ReadonlyArray<readonly string[]> = [
  ["grants", "create"],
  ["grants", "delete"],
  ["teams", "create"],
  ["teams", "get"],
  ["teams", "list"],
  ["users", "list"],
  ["variable", "list"],
  ["env"],
  ["env", "list"],
  ["doctor"],
  ["deploy"],
];

describe("UnknownCommand", () => {
  describe("with a word that is nothing like any command", () => {
    it("names the word and points at the CLI's help", () => {
      const { error } = new UnknownCommand("frobnicate", KNOWN);

      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: "frobnicate is not a zitadel command.",
        nextCommands: ["zitadel --help"],
      });
    });
  });

  describe("with a topic's command that does not exist", () => {
    it("names the topic and the word, and points at the topic's help", () => {
      const { error } = new UnknownCommand("teams:delete", KNOWN);

      expect(error).toMatchObject({
        message: "teams delete is not a zitadel command.",
        nextCommands: ["zitadel teams --help"],
      });
    });

    it("never offers another topic's command of that name", () => {
      const { error } = new UnknownCommand("teams:delete", KNOWN);

      expect(error.nextCommands).not.toContain("zitadel grants delete");
    });

    it("leaves out the arguments typed after it", () => {
      const { typed } = new UnknownCommand("teams:delete:team_secret_1", KNOWN);

      expect(typed).toEqual(["teams", "delete"]);
    });
  });

  describe("with a command that exists and an argument it does not take", () => {
    it.each([
      ["doctor:extra", ["doctor"]],
      ["env:extra", ["env"]],
      ["variable:list:extra", ["variable", "list"]],
    ])("%s names the command, not the argument", (id, command) => {
      const { error, typed } = new UnknownCommand(id, KNOWN);

      expect({ typed, message: error.message }).toEqual({
        typed: command,
        message: `${command.join(" ")} does not take the argument typed after it.`,
      });
    });
  });

  describe("as the exit code says it", () => {
    it.each([
      ["frobnicate", 127],
      ["teams:delete", 127],
      ["doctor:extra", 3],
      ["variable:list:extra", 3],
    ])("%s exits %s: a shell's code only for a name that is no command", (id, code) => {
      expect(new UnknownCommand(id, KNOWN).exitCode).toBe(code);
    });
  });

  describe("as the envelope names it", () => {
    it.each([
      ["teams:delete:team_secret_1", "teams:delete"],
      ["doctor:extra", "doctor"],
      ["--json", "(default)"],
    ])("%s is %s, as every other envelope names a command", (id, command) => {
      expect(new UnknownCommand(id, KNOWN).command).toBe(command);
    });
  });

  describe("with nothing usable typed", () => {
    it.each([["--json"], ["-x"], [""]])("%j names no command", (id) => {
      const { error } = new UnknownCommand(id, KNOWN);

      expect(error.message).toBe("That is not a zitadel command.");
    });
  });

  describe("with a misspelled command", () => {
    it.each([
      ["variable:lst", ["zitadel variable list --help", "zitadel variable --help"]],
      ["teams:lst:extra", ["zitadel teams list --help", "zitadel teams --help"]],
      ["env:lst", ["zitadel env list --help", "zitadel env --help"]],
      ["deplo", ["zitadel deploy --help"]],
      ["usrs:list", ["zitadel users --help"]],
      ["DEPLOY", ["zitadel deploy --help"]],
    ])("%s suggests the help of the one it meant", (id, next) => {
      const { error } = new UnknownCommand(id, KNOWN);

      expect(error.nextCommands).toEqual(next);
    });
  });
});

describe("UnknownCommand.among", () => {
  const DECLARED = [
    { id: "deploy", aliases: [] },
    { id: "deployment:list", aliases: ["deployments"] },
    { id: "debug", hidden: true, aliases: [] },
    { id: "secret:list", hidden: true, aliases: [] },
  ];

  it("never suggests a hidden command", () => {
    const { error } = UnknownCommand.among("debog", DECLARED);

    expect(error.nextCommands).toEqual(["zitadel --help"]);
  });

  it("names a hidden command followed by a word it does not take", () => {
    const { error } = UnknownCommand.among("debug:extra", DECLARED);

    expect(error.message).toBe("debug does not take the argument typed after it.");
  });

  it("never suggests the help of a topic only hidden commands are in", () => {
    const { error } = UnknownCommand.among("secret:lst", DECLARED);

    expect(error.nextCommands).toEqual(["zitadel --help"]);
  });

  it("suggests the alias a word is a single edit from", () => {
    const { error } = UnknownCommand.among("deploymnts", DECLARED);

    expect(error.nextCommands).toEqual(["zitadel deployments --help"]);
  });
});

describe("Invocation", () => {
  it.each([
    [["teams", "delete", "--json"], undefined, true],
    [["--json", "frobnicate"], undefined, true],
    [["frobnicate"], undefined, false],
    [["frobnicate", "--", "--json"], undefined, false],
    [["--json", "--", "x"], undefined, true],
    [["frobnicate"], "json", true],
    [["frobnicate"], "JSON", true],
    [["frobnicate"], "text", false],
  ])("%j with content type %s is %s", (argv, contentType, expected) => {
    expect(new Invocation(argv, contentType).wantsJson).toBe(expected);
  });

  describe("read from what was typed", () => {
    it.each([
      ["a colon word that is not a flag", "frobnicate:--json", [], ["frobnicate:--json"], false],
      [
        "a flag after a colon word",
        "frobnicate:--:value",
        [],
        ["frobnicate:--:value", "--json"],
        true,
      ],
      [
        "a --json oclif dropped after a colon word",
        "teams:delete:a:b",
        [],
        ["teams", "delete", "a:b", "--json"],
        true,
      ],
      [
        "a --json before the pass-through",
        "bogus:a:b",
        ["--", "x"],
        ["bogus", "a:b", "--json", "--", "x"],
        true,
      ],
      [
        "a --json after the pass-through",
        "bogus",
        ["--", "--json"],
        ["bogus", "--", "--json"],
        false,
      ],
      [
        "the words of a run in another process's arguments",
        "teams:delete:x",
        ["--json"],
        ["run", "cli.spec.ts"],
        true,
      ],
      ["a host process's own --json", "frobnicate", [], ["run", "--json"], false],
    ])("with %s", (_, id, argv, processArgv, expected) => {
      expect(Invocation.typed(id, argv, processArgv, undefined).wantsJson).toBe(expected);
    });
  });
});
