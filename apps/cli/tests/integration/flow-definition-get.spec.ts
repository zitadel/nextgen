import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";

usePlatformMock();

describe("flow-definition get", () => {
  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["flow-definition", "get", "no-such-flow"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses a name no flow carries, and says how to list them", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["flow-definition", "get", "no-such-flow", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_NOT_FOUND",
          hint: "Run `flow-definition list` to see the flows this project has.",
        });
      });
    });
  });
});
