import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp } from "@tests/helpers/project";
import { parseJson } from "@tests/helpers/run-cli";

usePlatformMock();

describe("commands", () => {
  it("lists every command in every rendering", async () => {
    const app = await anApp();

    await app.inEveryRendering((how) => {
      return app.runWithoutServer(how.json ? ["commands", "--json"] : ["commands"], how.env);
    });
  });

  describe("--json", () => {
    it("answers with the commands as the envelope's data", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["commands", "--json"]);

      expect(result).toSucceed();
      expect(parseJson(result.stdout)).toMatchObject({
        status: "ok",
        command: "commands",
        data: { result: expect.arrayContaining([expect.objectContaining({ id: "commands" })]) },
      });
    });

    it("lists the hidden commands with --hidden", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["commands", "--hidden", "--json"]);

      expect(result).toSucceed();
      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          result: expect.arrayContaining([expect.objectContaining({ id: "deployments:create" })]),
        },
      });
    });

    it("refuses a column it has none of", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["commands", "--sort", "bogus", "--json"]);

      expect(result).toFailWith("E_VALIDATION");
    });
  });

  describe("--columns", () => {
    it("draws only the columns asked for", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["commands", "--columns", "id"]);

      expect(result).toSucceed();
      expect(result.stdout).not.toContain("Summary");
    });
  });

  describe("--tree", () => {
    it("draws the commands as a tree", async () => {
      const app = await anApp();

      const result = await app.runWithoutServer(["commands", "--tree"]);

      expect(result).toSucceed();
      expect(result.stdout).toContain("└─");
    });
  });
});
