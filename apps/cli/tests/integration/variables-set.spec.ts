import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("variables set", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("enters a variable on the project", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("FOO", "bar");

        expect(result).toSucceed();
      });

      it("reports the name it entered", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("FOO", "bar");

        expect(app.envelopeOf<{ name: string }>(result).data.name).toBe("FOO");
      });

      it("says a secret is held as a secret", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("TOKEN", "s3cret", { secret: true });

        expect(app.envelopeOf<{ secret: boolean }>(result).data.secret).toBe(true);
      });
    });

    describe("with no value piped in", () => {
      it("is refused", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("FOO");

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("No value for FOO supplied");
        expect(result).toHintAt("Pipe it in on stdin.");
      });

      it("suggests the command that pipes it in", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("TOKEN", { secret: true });

        expect(result).toSuggest("variables set TOKEN --project-level --secret < value.txt");
      });

      it("enters nothing", async () => {
        const app = await aSetUpApp();

        await app.setVariableWithNothingPiped("FOO");

        expect(await app.projectVariables()).toEqual([]);
      });
    });

    it("enters nothing on a dry run", async () => {
      const app = await aSetUpApp();

      const result = await app.run([
        "variables",
        "set",
        "FOO",
        "--project-level",
        "--dry-run",
        "--json",
      ]);

      expect(result).toSucceed();
      expect(await app.projectVariables()).toEqual([]);
    });
  });
});
