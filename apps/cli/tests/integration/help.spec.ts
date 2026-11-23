import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp } from "@tests/helpers/project";
import { parseJson } from "@tests/helpers/run-cli";

usePlatformMock();

describe("help", () => {
  it("answers in every rendering", async () => {
    const app = await anApp();

    await app.inEveryRendering((how) => {
      return app.runWithoutServer(how.json ? ["help", "--json"] : ["help"], how.env);
    });
  });

  describe("--json", () => {
    it("answers with the help as the envelope's output", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["help", "--json"]);

      expect(result).toSucceed();
      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        command: "help",
        data: { output: expect.any(String) },
      });
    });

    it("takes --nested-commands", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["help", "--nested-commands", "--json"]);

      expect(result).toSucceed();
    });
  });
});
