import { Config, Errors } from "@oclif/core";
import { afterEach, describe, expect, it } from "vitest";

import { RESOURCES } from "@/cli/commands/resources";
import { NotFound } from "@/cli/hooks/command-not-found";
import { EXIT_CODES } from "@/lib/errors";
import { COLLECTION_PLURALS, LISTED_COLLECTIONS } from "@tests/helpers/collections";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { expectedPublicCliCommand, parseJson, printing } from "@tests/helpers/run-cli";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

const config = await Config.load(cliPackageRoot);
const argv = process.argv;

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
    it.each(COLLECTION_PLURALS)("offers, for %s alone, the help of %s", async (plural, noun) => {
      const { stdout } = await printing(() => {
        return rejectionOf(() => {
          return NotFound.run([plural, "--json"], config);
        });
      });

      expect(parseJson(stdout)).toMatchObject({
        message: `${plural} is not a zitadel command`,
        next_commands: [expectedPublicCliCommand(`${noun} --help`)],
      });
    });

    it.each(COLLECTION_PLURALS)(
      "reads %s as %s when a word that is no command of it follows",
      async (plural, noun) => {
        const { stdout } = await printing(() => {
          return rejectionOf(() => {
            return NotFound.run([plural, "frobnicate", "--json"], config);
          });
        });

        expect(parseJson(stdout)).toMatchObject({
          command: `${noun}:frobnicate`,
          message: `${noun} frobnicate is not a zitadel command`,
          next_commands: [expectedPublicCliCommand(`${noun} --help`)],
        });
      },
    );

    it("offers the command a word after the plural is one edit from", async () => {
      const { stdout } = await printing(() => {
        return rejectionOf(() => {
          return NotFound.run(["policies", "lst", "--json"], config);
        });
      });

      expect(parseJson(stdout)).toMatchObject({
        next_commands: [
          expectedPublicCliCommand("policy list --help"),
          expectedPublicCliCommand("policy --help"),
        ],
      });
    });

    it("covers every resource the registry generates commands for", () => {
      const listed = LISTED_COLLECTIONS.map(({ noun }) => {
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
