import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("variables get", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.getVariable("FOO");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.getVariable("FOO");

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("reads back a value that was entered", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("FOO", "bar")).toSucceed();

        const result = await app.getVariable("FOO");

        expect(result).toSucceed();
        expect(app.envelopeOf<{ value: string }>(result).data.value).toBe("bar");
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.getVariable("NOT_THERE");

        expect(result).toFail();
      });

      it("withholds a secret's value", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("TOKEN", "s3cret", { secret: true })).toSucceed();

        const result = await app.getVariable("TOKEN");

        expect(result).toSucceed();
        expect(app.envelopeOf<{ secret: boolean }>(result).data).toMatchObject({ secret: true });
        expect(app.envelopeOf<Record<string, unknown>>(result).data).not.toHaveProperty("value");
      });
    });
  });
});
