import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("variable set", () => {
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

    it("enters nothing on a dry run", async () => {
      const app = await aSetUpApp();

      const result = await app.run([
        "variable",
        "set",
        "FOO",
        "--dry-run",
        "--json",
      ]);

      expect(result).toSucceed();
      expect(await app.projectVariables()).toEqual([]);
    });
  });
});
