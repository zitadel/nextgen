import { Config, Errors } from "@oclif/core";
import { operations } from "@zitadel/api/generated/operations";
import { afterEach, describe, expect, it } from "vitest";

import { RESOURCES } from "@/cli/commands/resources";
import { NotFound } from "@/cli/hooks/command-not-found";
import { EXIT_CODES } from "@/lib/errors";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { expectedPublicCliCommand, parseJson, printing } from "@tests/helpers/run-cli";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

const config = await Config.load(cliPackageRoot);
const argv = process.argv;

/**
 * Each command that lists a collection, with the name the API gives that
 * collection: the field its page holds the items under (`policies` for
 * `policy list`). That name is the plural someone who knows the API, or the
 * CLI from before its nouns were singular, types for the command's noun, and
 * it comes from the spec, not from the rule the hook forms a plural by.
 */
const LISTED = operations.flatMap((operation) => {
  const [noun, verb] = operation.cli?.split(" ") ?? [];
  return noun !== undefined && verb === "list" && operation.paging !== null
    ? [{ noun, collection: operation.paging.items.replaceAll("_", "-") }]
    : [];
});

/** The collections whose name is not their command's own (`branding` is both). */
const PLURALS = LISTED.filter(({ noun, collection }) => {
  return collection !== noun;
}).map(({ noun, collection }) => {
  return [collection, noun] as const;
});

afterEach(() => {
  process.argv = argv;
});

describe("NotFound", () => {
  describe("exit", () => {
    it.each([
      ["a validation failure before it refused", EXIT_CODES.E_VALIDATION],
      ["a cancel", EXIT_CODES.E_CANCELLED],
      ["any other failure", 1],
    ])("exits %s with its own code %s", (_, code) => {
      const command = new NotFound([], config);

      const exit = thrownBy(() => command.exit(code));

      expect(exit).toBeInstanceOf(Errors.ExitError);
      expect(exit).toMatchObject({ oclif: { exit: code } });
    });
  });

  describe("when the word typed is the plural of a command's noun", () => {
    it.each(PLURALS)("offers, for %s, the help of %s first", async (plural, noun) => {
      const { stdout } = await printing(() => {
        return rejectionOf(() => {
          return NotFound.run([plural, "list", "--json"], config);
        });
      });

      expect(parseJson(stdout)).toMatchObject({
        message: `${plural} is not a zitadel command`,
        next_commands: [expectedPublicCliCommand(`${noun} --help`)],
      });
    });

    it("covers every resource the registry generates commands for", () => {
      const listed = LISTED.map(({ noun }) => {
        return noun;
      });

      expect(
        Object.keys(RESOURCES).filter((topic) => {
          return !listed.includes(topic);
        }),
      ).toEqual([]);
    });
  });

  describe("when the CLI is the program run", () => {
    it("names a word with a colon of its own as it was typed", async () => {
      process.argv = [process.execPath, "zitadel", "https://example.com", "--json"];

      const { stdout } = await printing(() => {
        return rejectionOf(() => {
          return config.runHook("command_not_found", { id: "https://example.com", argv: [] });
        });
      });

      expect(parseJson(stdout)).toMatchObject({
        command: "https://example.com",
        message: "https://example.com is not a zitadel command",
      });
    });
  });
});
