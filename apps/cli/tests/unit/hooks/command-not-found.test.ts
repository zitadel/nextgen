import { Config, Errors } from "@oclif/core";
import { afterEach, describe, expect, it } from "vitest";

import { NotFound } from "@/hooks/command-not-found";
import { EXIT_CODES } from "@/lib/errors";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { parseJson, printing } from "@tests/helpers/run-cli";
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
