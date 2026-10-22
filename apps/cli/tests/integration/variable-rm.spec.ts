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

        const result = await app.removeVariable("FOO");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.removeVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.removeVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("removes a variable that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.removeVariable("FOO");

        expect(result).toSucceed();
      });

      it("leaves the project without that variable", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        expect(await app.removeVariable("FOO")).toSucceed();

        expect(await app.projectVariables()).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "FOO" })]),
        );
      });

      it("removes the preview override", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");
        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        await app.removeVariable("API_URL", { preview: true });

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("removes a variable for both kinds without --preview", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        await app.removeVariable("API_URL");

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("leaves the primary value when removing the preview value", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");
        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        await app.removeVariable("API_URL", { preview: true });

        expect(await app.projectVariables()).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
        ]);
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.removeVariable("NOT_THERE");

        expect(result).toFail();
      });
    });

    describe("without --force when no one can be asked", () => {
      it("is refused", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.run(["variable", "rm", "FOO", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toHintAt("--force");
        expect(result).toSuggest("variable rm FOO --force");
      });

      it("removes nothing", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        await app.run(["variable", "rm", "FOO", "--json"]);

        expect(await app.projectVariables()).toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "FOO" })]),
        );
      });
    });

    it("removes nothing on a dry run", async () => {
      const app = await aSetUpApp();
      expect(await app.setVariable("FOO", "bar")).toSucceed();

      const result = await app.run(["variable", "rm", "FOO", "--force", "--dry-run", "--json"]);

      expect(result).toSucceed();
      expect(await app.projectVariables()).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "FOO" })]),
      );
    });
  });
});
