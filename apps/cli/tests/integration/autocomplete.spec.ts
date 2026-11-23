import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp } from "@tests/helpers/project";
import { parseJson } from "@tests/helpers/run-cli";

usePlatformMock();

describe("autocomplete", () => {
  it("answers in every rendering", async () => {
    const app = await anApp();

    await app.inEveryRendering((how) => {
      return app.runWithoutServer(
        how.json ? ["autocomplete", "bash", "--json"] : ["autocomplete", "bash"],
        how.env,
      );
    });
  });

  describe("--json", () => {
    it("answers with the setup instructions as the envelope's output", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["autocomplete", "bash", "--json"]);

      expect(result).toSucceed();
      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        command: "autocomplete",
        data: { output: expect.any(String) },
      });
    });

    it("only rebuilds the cache with --refresh-cache, leaving the setup instructions out", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer([
        "autocomplete",
        "bash",
        "--refresh-cache",
        "--json",
      ]);

      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        data: { output: "" },
      });
    });
  });
});
