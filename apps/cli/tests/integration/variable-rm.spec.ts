import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("variable rm", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.deleteVariable("FOO");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.deleteVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("removes a variable that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.deleteVariable("FOO");

        expect(result).toSucceed();
      });

      it("leaves the project without that variable", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        expect(await app.deleteVariable("FOO")).toSucceed();

        expect(await app.projectVariables()).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "FOO" })]),
        );
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.deleteVariable("NOT_THERE");

        expect(result).toFail();
      });
    });

    it("removes nothing on a dry run", async () => {
      const app = await aSetUpApp();
      expect(await app.setVariable("FOO", "bar")).toSucceed();

      const result = await app.run([
        "variable",
        "rm",
        "FOO",
        "--force",
        "--dry-run",
        "--json",
      ]);

      expect(result).toSucceed();
      expect(await app.projectVariables()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "FOO" })]),
      );
    });
  });
});
