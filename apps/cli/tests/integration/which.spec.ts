import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp } from "@tests/helpers/project";
import { parseJson } from "@tests/helpers/run-cli";

usePlatformMock();

describe("which", () => {
  it("answers in every rendering", async () => {
    const app = await anApp();

    await app.inEveryRendering((how) => {
      return app.runWithoutServer(
        how.json ? ["which", "version", "--json"] : ["which", "version"],
        how.env,
      );
    });
  });

  describe("--json", () => {
    it("names the plugin a command is in", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["which", "version", "--json"]);

      expect(result).toSucceed();
      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        command: "which",
        data: { plugin: expect.any(String) },
      });
    });
  });
});
