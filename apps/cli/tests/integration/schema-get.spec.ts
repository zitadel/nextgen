import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { expectedPublicCliCommand } from "@tests/helpers/run-cli";

usePlatformMock();

describe("schema get", () => {
  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["schema", "get", "no-such-type"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses an object type no schema carries, and says how to list them", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["schema", "get", "no-such-type", "--json"]);

        expect(app.envelopeOf(result)).toMatchObject({
          status: "error",
          code: "E_NOT_FOUND",
          hint: `Run ${expectedPublicCliCommand("schema list")} to see the object types this project has.`,
        });
      });
    });
  });
});
