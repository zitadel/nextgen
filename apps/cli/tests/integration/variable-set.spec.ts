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
      it("enters a plain value given on the command line", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "set", "FOO", "bar", "--json"]);

        expect(result).toSucceed();
        const [row] = await app.projectVariables();
        expect(row).toEqual({ name: "FOO", secret: false, value: "bar" });
      });

      it("enters a plain value piped in when none is given", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("FOO", "bar");

        expect(app.envelopeOf<{ name: string }>(result).data.name).toBe("FOO");
      });

      it("refuses a value on the command line for a secret", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "set", "TOKEN", "s3cret", "--secret", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("reads the secret back from the store as held without a value", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariable("TOKEN", "s3cret", { secret: true });

        // The state comes from reading the variable back, not the request flag:
        // the `all` slot holds the secret, with no value disclosed.
        const { all } = app.envelopeOf<{ all: { held: boolean; secret?: boolean } }>(result).data;
        expect(all).toEqual({ held: true, secret: true });
      });

      it("reports a preview write back in the preview slot, leaving the all slot standing", async () => {
        const app = await aSetUpApp();
        expect(await app.setVariable("API_URL", "https://api.acme.com")).toSucceed();

        const result = await app.setVariable("API_URL", "https://preview.acme.com", {
          preview: true,
        });

        const { all, preview } = app.envelopeOf<{
          all: Record<string, unknown>;
          preview: Record<string, unknown>;
        }>(result).data;
        expect(all).toEqual({ held: true, secret: false, value: "https://api.acme.com" });
        expect(preview).toEqual({ held: true, secret: false, value: "https://preview.acme.com" });
      });

      it("writes the preview override into its own bucket", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        expect(await app.projectVariables()).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
        ]);
        expect(await app.projectVariables({ preview: true })).toEqual([
          { name: "API_URL", secret: false, value: "https://preview.acme.com" },
        ]);
      });
    });

    describe("rendered for a terminal", () => {
      it("reports the name it set", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["variable", "set", "FOO", "bar"]);

        expect(result).toPrint("FOO");
      });
    });

    it("enters nothing on a dry run", async () => {
      const app = await aSetUpApp();

      const result = await app.run(["variable", "set", "FOO", "bar", "--dry-run", "--json"]);

      expect(result).toSucceed();
      expect(await app.projectVariables()).toEqual([]);
    });
  });
});
