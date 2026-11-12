import { Config, Errors } from "@oclif/core";
import { afterEach, describe, expect, it } from "vitest";

import { NotFound } from "@/hooks/command-not-found";
import { EXIT_CODES } from "@/lib/errors";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { captureStreams, parseJson } from "@tests/helpers/run-cli";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

const config = await Config.load(cliPackageRoot);
const argv = process.argv;

afterEach(() => {
  process.argv = argv;
});

describe("NotFound.exit", () => {
  it.each([
    ["a refusal", EXIT_CODES.E_VALIDATION, 127],
    ["a cancel", EXIT_CODES.E_CANCELLED, EXIT_CODES.E_CANCELLED],
    ["any other failure", 1, 1],
  ])("exits %s with %s as %s", (_, code, exitCode) => {
    const command = new NotFound([], config);

    const exit = thrownBy(() => command.exit(code));

    expect(exit).toBeInstanceOf(Errors.ExitError);
    expect(exit).toMatchObject({ oclif: { exit: exitCode } });
  });
});

describe("the command_not_found hook", () => {
  describe("when the CLI is the program run", () => {
    it("names a word with a colon of its own as it was typed", async () => {
      process.argv = [process.execPath, "zitadel", "https://example.com", "--json"];
      const output = captureStreams();

      await rejectionOf(() => {
        return config.runHook("command_not_found", { id: "https://example.com", argv: [] });
      });
      output.restore();

      expect(parseJson(output.read().stdout)).toMatchObject({
        command: "https://example.com",
        message: "https://example.com is not a zitadel command",
      });
    });
  });
});
