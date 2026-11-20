import { Command } from "@oclif/core";
import { describe, expect, it } from "vitest";

import {
  aliasedCommands,
  aliasedNouns,
  answeringToPlurals,
  pluralAliasOf,
} from "@/lib/oclif/plural-aliases";

/** A table of commands that do nothing, one fresh class per id. */
function aTable(...ids: string[]): Record<string, typeof Command> {
  return Object.fromEntries(
    ids.map((id) => {
      return [
        id,
        class extends Command {
          async run(): Promise<void> {}
        },
      ];
    }),
  );
}

/** The command list oclif builds of one command and the alias it answers to. */
const LISTED = [
  { id: "policy:list", hiddenAliases: ["policies:list"] },
  { id: "policies:list", hiddenAliases: ["policies:list"] },
  { id: "deploy", hiddenAliases: [] },
];

describe("pluralAliasOf", () => {
  it.each([
    ["user:list", "users:list"],
    ["policy:test", "policies:test"],
    ["flow-definition:get", "flow-definitions:get"],
    ["auth-method:sso:enable", "auth-methods:sso:enable"],
  ])("spells %j as %j", (id, expected) => {
    expect(pluralAliasOf(id)).toBe(expected);
  });

  it("gives a command of one word no plural, which would run it", () => {
    expect(pluralAliasOf("preview")).toBeUndefined();
  });
});

describe("answeringToPlurals", () => {
  it("makes a command of a noun answer to the noun's plural", () => {
    const table = aTable("policy:list");

    answeringToPlurals(table, new Set());

    expect(table["policy:list"]?.hiddenAliases).toEqual(["policies:list"]);
  });

  it("leaves a command of one word answering to its own name alone", () => {
    const table = aTable("preview");

    answeringToPlurals(table, new Set());

    expect(table.preview?.hiddenAliases).toEqual([]);
  });

  it("leaves the commands of a noun without a plural alone", () => {
    const table = aTable("branding:list");

    answeringToPlurals(table, new Set(["branding"]));

    expect(table["branding:list"]?.hiddenAliases).toEqual([]);
  });

  it("hands back the table it was given", () => {
    const table = aTable("user:get");

    expect(answeringToPlurals(table, new Set())).toBe(table);
  });
});

describe("aliasedCommands", () => {
  it("names the command behind each alias, and not the alias's own copy", () => {
    expect([...aliasedCommands(LISTED)]).toEqual([["policies:list", "policy:list"]]);
  });
});

describe("aliasedNouns", () => {
  it("names the noun behind each plural", () => {
    expect([...aliasedNouns(LISTED)]).toEqual([["policies", "policy"]]);
  });
});
