import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp } from "@tests/helpers/project";
import { cliVersion, parseJson } from "@tests/helpers/run-cli";

usePlatformMock();

describe("version", () => {
  it("answers in every rendering", async () => {
    const app = await anApp();

    await app.inEveryRendering((how) => {
      return app.runWithoutServer(how.json ? ["version", "--json"] : ["version"], how.env);
    });
  });

  describe("--json", () => {
    it("reports the CLI's version", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["version", "--json"]);

      expect(result).toSucceed();
      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        command: "version",
        cli_version: cliVersion.version,
      });
    });

    it("adds what the machine runs with --verbose", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["version", "--verbose", "--json"]);

      expect(result).toSucceed();
      expect(parseJson(result.stdout)).toMatchObject({
        data: { architecture: expect.any(String) },
      });
    });
  });
});
