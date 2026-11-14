import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Config } from "@oclif/core";
import { describe, expect } from "vitest";
import { z } from "zod";

import { COMMANDS, NO_PLURAL } from "@/index";
import { aliasedCommands, pluralAliasOf } from "@/lib/oclif/plural-aliases";
import { COLLECTION_PLURALS } from "@tests/helpers/collections";
import { it } from "@tests/helpers/fixtures";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

/** The built CLI's command list, as a run reads it. */
const config = await Config.load(cliPackageRoot);

/** The command behind each plural spelling the built CLI answers to. */
const ANSWERED = aliasedCommands(config.commands);

/**
 * The commands as they are declared: oclif lists an alias, shown or hidden, as
 * a copy of its command under the alias's id, and those copies are left out.
 */
const DECLARED = config.commands.filter((command) => {
  return ![...command.aliases, ...(command.hiddenAliases ?? [])].includes(command.id);
});

/** The first word of a command's id: its noun, when more words follow. */
function nounOf(id: string): string {
  return id.split(":")[0] ?? "";
}

/** Every command of more than one word: a noun, then what to do with it. */
const NOUN_VERB = Object.keys(COMMANDS).filter((id) => {
  return id.includes(":");
});

/** Each plural spelling the table must answer to, with the command it runs. */
const PLURAL_SPELLINGS = NOUN_VERB.filter((id) => {
  return !(nounOf(id) in NO_PLURAL);
}).map((id) => {
  return [pluralAliasOf(id) ?? "", id] as const;
});

/** What `zitadel commands --json` prints, as far as a command's name goes. */
const LISTED_ROWS = z.array(z.object({ id: z.string() }));

/** The CLI reference the docs site renders, as far as a command's names go. */
const REFERENCE = z.object({
  commands: z.array(z.object({ id: z.string(), aliases: z.array(z.string()).optional() })),
});

/** A run of the built CLI in `dir`, as a script reads it. */
function inDirectory(dir: string, id: string): string[] {
  return [...id.split(":"), "--cwd", dir, "--json", "--non-interactive", "--no-telemetry"];
}

describe("COMMANDS", () => {
  describe("with a noun that has a plural", () => {
    it("answers to the plural for every command of the noun, and to nothing else", () => {
      expect(Object.fromEntries(ANSWERED)).toEqual(Object.fromEntries(PLURAL_SPELLINGS));
    });

    it.each(COLLECTION_PLURALS)(
      "answers to %s, as the API names the collection, for every command of %s",
      (collection, noun) => {
        const commands = NOUN_VERB.filter((id) => {
          return nounOf(id) === noun;
        });

        expect(
          commands.map((id) => {
            return ANSWERED.get(id.replace(noun, collection));
          }),
        ).toEqual(commands);
      },
    );

    it.for(PLURAL_SPELLINGS)(
      "answers %s with the envelope of %s",
      async ([plural, id], { dir }) => {
        const declared = await runCliForTest(inDirectory(dir, id));

        const answered = await runCliForTest(inDirectory(dir, plural));

        expect(parseJson(answered.stdout)).toEqual(parseJson(declared.stdout));
      },
    );

    it.for(PLURAL_SPELLINGS)("names %s as %s in its envelope", async ([plural, id], { dir }) => {
      const answered = await runCliForTest(inDirectory(dir, plural));

      expect(parseJson(answered.stdout)).toMatchObject({ command: id });
    });
  });

  describe("with a noun that has no plural", () => {
    it("names only nouns the table has commands of", () => {
      const nouns = NOUN_VERB.map(nounOf);

      expect(
        Object.keys(NO_PLURAL).filter((noun) => {
          return !nouns.includes(noun);
        }),
      ).toEqual([]);
    });
  });

  describe("the plural spellings", () => {
    it("are hidden in the command list, which help and completion read", () => {
      expect(
        config.commands.filter((command) => {
          return ANSWERED.has(command.id) && command.hidden !== true;
        }),
      ).toEqual([]);
    });

    it("are no alias a command shows, which completion and the reference list", () => {
      expect(
        config.commands.flatMap((command) => {
          return command.aliases.filter((alias) => {
            return ANSWERED.has(alias);
          });
        }),
      ).toEqual([]);
    });

    it("are in none of the rows the commands command prints", async () => {
      const listed = await runCliForTest(["commands", "--json"]);

      const rows = LISTED_ROWS.parse(parseJson(listed.stdout));
      expect(
        rows.filter((row) => {
          return ANSWERED.has(row.id);
        }),
      ).toEqual([]);
    });

    it("are in none of the commands the CLI reference documents", async () => {
      const reference = REFERENCE.parse(
        JSON.parse(await readFile(join(cliPackageRoot, "command-reference.json"), "utf8")),
      );

      expect(
        reference.commands
          .flatMap((command) => {
            return [command.id, ...(command.aliases ?? [])];
          })
          .filter((name) => {
            return ANSWERED.has(name.replaceAll(" ", ":"));
          }),
      ).toEqual([]);
    });

    it("collide with no command, no alias and no other plural", () => {
      const names = DECLARED.flatMap((command) => {
        return [command.id, ...command.aliases, ...(command.hiddenAliases ?? [])];
      });

      expect(
        names.filter((name, at) => {
          return names.indexOf(name) !== at;
        }),
      ).toEqual([]);
    });

    it("start with no word a command starts with", () => {
      const declared = DECLARED.map((command) => {
        return nounOf(command.id);
      });

      expect(
        [...ANSWERED.keys()].map(nounOf).filter((plural) => {
          return declared.includes(plural);
        }),
      ).toEqual([]);
    });
  });
});
