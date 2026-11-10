import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";

const platform = usePlatformMock();

describe("variable rm", () => {
  describe("a name the platform cannot accept", () => {
    // Every command that names a variable refuses the name itself, so neither a
    // dry run nor a confirmation can report work the platform would never do.
    it.each([
      ["GOOGLE-CLIENT", "a dash"],
      ["a.b", "a dot"],
      ["has space", "a space"],
      ["A".repeat(256), "more characters than the limit"],
    ])("is refused for %s", async (name) => {
      const app = await aSetUpApp();

      const result = await app.removeVariable(name);

      expect(result).toFailWith("E_VALIDATION");
    });

    it("is refused on a dry run too, which otherwise reports a removal it could not make", async () => {
      const app = await aSetUpApp();

      const result = await app.removeVariable("GOOGLE-CLIENT", { dryRun: true });

      expect(result).toFailWith("E_VALIDATION");
    });
  });

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
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.setVariable("HOST", "app.acme.com");
      platform.servesAHostileOrigin();
      const args = ["variable", "rm", "HOST", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

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

        expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
      });

      it("says to pass --force", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.run(["variable", "rm", "FOO", "--json"]);

        expect(result).toHintAt("--force");
      });

      it("suggests running it again with --force", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.run(["variable", "rm", "FOO", "--json"]);

        expect(result).toSuggestExactly(app.againAsRun("variable rm FOO --force"));
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
