import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("variable get", () => {
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

      const result = await app.getVariable(name);

      expect(result).toFailWith("E_VALIDATION");
    });

    it("is refused on a dry run too, which otherwise reports work it could not do", async () => {
      const app = await aSetUpApp();

      const result = await app.getVariable("GOOGLE-CLIENT", { dryRun: true });

      expect(result).toFailWith("E_VALIDATION");
    });
  });

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

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

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

      it("reads the preview override under --preview", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("API_URL", "https://api.acme.com")).toSucceed();
        expect(
          await app.setVariable("API_URL", "https://preview.acme.com", { preview: true }),
        ).toSucceed();

        const result = await app.getVariable("API_URL", { preview: true });

        expect(app.envelopeOf<{ value: string }>(result).data.value).toBe(
          "https://preview.acme.com",
        );
      });

      it("refuses a name the project does not hold", async () => {
        const app = await aSetUpApp();

        const result = await app.getVariable("NOT_THERE");

        expect(result).toFail();
      });

      it("gives a pipe a body that parses back to the value that was stored", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("BANNER", "a\u009bb")).toSucceed();

        const result = await app.getVariable("BANNER", { json: false });

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u009b");
        expect(JSON.parse(result.stdout)).toMatchObject({ value: "a\u009bb" });
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
