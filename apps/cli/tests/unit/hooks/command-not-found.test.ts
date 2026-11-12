import { describe, expect, it } from "vitest";

import { unknownCommand, wantsJson } from "@/hooks/command-not-found";

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

describe("unknownCommand", () => {
  describe("with a word that is nothing like any command", () => {
    it("names the word and points at the CLI's help", () => {
      const { error } = unknownCommand("frobnicate", KNOWN);

      expect(error).toMatchObject({
        code: "E_VALIDATION",
        message: "frobnicate is not a zitadel command.",
        nextCommands: ["zitadel --help"],
      });
    });
  });

  describe("with a topic's command that does not exist", () => {
    it("names the topic and the word, and points at the topic's help", () => {
      const { error } = unknownCommand("teams:delete", KNOWN);

      expect(error).toMatchObject({
        message: "teams delete is not a zitadel command.",
        nextCommands: ["zitadel teams --help"],
      });
    });

    it("never offers another topic's command of that name", () => {
      const { error } = unknownCommand("teams:delete", KNOWN);

      expect(error.nextCommands).not.toContain("zitadel grants delete");
    });

    it("leaves out the arguments typed after it", () => {
      const { typed } = unknownCommand("teams:delete:team_secret_1", KNOWN);

      expect(typed).toEqual(["teams", "delete"]);
    });
  });

  describe("with a command that exists and an argument it does not take", () => {
    it.each([
      ["doctor:extra", ["doctor"]],
      ["env:extra", ["env"]],
      ["variable:list:extra", ["variable", "list"]],
    ])("%s names the command, not the argument", (id, command) => {
      const { error, typed } = unknownCommand(id, KNOWN);

      expect({ typed, message: error.message }).toEqual({
        typed: command,
        message: `${command.join(" ")} does not take the argument typed after it.`,
      });
    });
  });

  describe("with nothing usable typed", () => {
    it.each([["--json"], ["-x"], [""]])("%j names no command", (id) => {
      const { error } = unknownCommand(id, KNOWN);

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
      const { error } = unknownCommand(id, KNOWN);

      expect(error.nextCommands).toEqual(next);
    });
  });
});

describe("wantsJson", () => {
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
    expect(wantsJson(argv, contentType)).toBe(expected);
  });
});
