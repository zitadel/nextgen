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
    describe("with no value piped in", () => {
      it("is refused", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("FOO");

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says no value was supplied", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("FOO");

        expect(result).toExplain("No value for FOO supplied");
      });

      it("hints at piping the value in", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("FOO");

        expect(result).toHintAt("Pipe it in on stdin.");
      });

      it("suggests the command that pipes it in", async () => {
        const app = await aSetUpApp();

        const result = await app.setVariableWithNothingPiped("TOKEN", { secret: true });

        expect(result).toSuggest("variable set TOKEN --secret");
      });

      it("enters nothing", async () => {
        const app = await aSetUpApp();

        await app.setVariableWithNothingPiped("FOO");

        expect(await app.projectVariables()).toEqual([]);
      });
    });

    describe("--json", () => {
      it("enters a plain value given on the command line", async () => {
        const app = await aSetUpApp();

        await app.run(["variable", "set", "FOO", "bar", "--json"]);

        expect(await app.projectVariables()).toEqual([
          { name: "FOO", secret: false, value: "bar" },
        ]);
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

        const { primary } = app.envelopeOf<{ primary: { held: boolean; secret?: boolean } }>(
          result,
        ).data;
        expect(primary).toEqual({ held: true, secret: true });
      });

      it("stores a plain value for both kinds", async () => {
        const app = await aSetUpApp();

        await app.setVariable("API_URL", "https://api.acme.com");

        expect(await app.projectVariables({ preview: true })).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
        ]);
      });

      it("stores a secret for the primary kind only", async () => {
        const app = await aSetUpApp();

        await app.setVariable("TOKEN", "s3cret", { secret: true });

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("drops a preview value a secret replaces, so a preview keeps no plaintext copy", async () => {
        const app = await aSetUpApp();
        await app.setVariable("TOKEN", "plain");

        await app.setVariable("TOKEN", "s3cret", { secret: true });

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("refuses a plain preview value for a secret", async () => {
        const app = await aSetUpApp();
        await app.setVariable("TOKEN", "s3cret", { secret: true });

        const result = await app.run(["variable", "set", "TOKEN", "plain", "--preview", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("suggests setting a secret's preview value as a secret", async () => {
        const app = await aSetUpApp();
        await app.setVariable("TOKEN", "s3cret", { secret: true });

        const result = await app.run(["variable", "set", "TOKEN", "plain", "--preview", "--json"]);

        expect(result).toSuggest("variable set TOKEN --secret --preview");
      });

      it("writes no plain preview value for a secret", async () => {
        const app = await aSetUpApp();
        await app.setVariable("TOKEN", "s3cret", { secret: true });

        await app.run(["variable", "set", "TOKEN", "plain", "--preview", "--json"]);

        expect(await app.projectVariables({ preview: true })).toEqual([]);
      });

      it("reports a preview write back in the preview kind", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        const result = await app.setVariable("API_URL", "https://preview.acme.com", {
          preview: true,
        });

        expect(app.envelopeOf<{ preview: Record<string, unknown> }>(result).data.preview).toEqual({
          held: true,
          secret: false,
          value: "https://preview.acme.com",
        });
      });

      it("reports the primary value still standing after a preview write", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        const result = await app.setVariable("API_URL", "https://preview.acme.com", {
          preview: true,
        });

        expect(app.envelopeOf<{ primary: Record<string, unknown> }>(result).data.primary).toEqual({
          held: true,
          secret: false,
          value: "https://api.acme.com",
        });
      });

      it("writes the preview value into its own kind", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        expect(await app.projectVariables({ preview: true })).toEqual([
          { name: "API_URL", secret: false, value: "https://preview.acme.com" },
        ]);
      });

      it("leaves the primary kind alone on a preview write", async () => {
        const app = await aSetUpApp();
        await app.setVariable("API_URL", "https://api.acme.com");

        await app.setVariable("API_URL", "https://preview.acme.com", { preview: true });

        expect(await app.projectVariables()).toEqual([
          { name: "API_URL", secret: false, value: "https://api.acme.com" },
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

      await app.run(["variable", "set", "FOO", "bar", "--dry-run", "--json"]);

      expect(await app.projectVariables()).toEqual([]);
    });
  });
});
