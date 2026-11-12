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
  ];

  it("never suggests a hidden command", () => {
    const { error } = UnknownCommand.among("debog", DECLARED);

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
});
