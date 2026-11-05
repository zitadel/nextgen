import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp, SETUP_ORIGIN } from "@tests/helpers/project";
import { asTerminal, RENDERINGS } from "@tests/helpers/terminal";

const platform = usePlatformMock();

describe("origin add", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["origin", "add", "https://wiped\u001b[2J.example.com", "--kind", "primary"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses an environment holding only the preview token", async () => {
        const app = await anApp();
        await app.bindEnvironment("ci", {
          ZITADEL_PROJECT_ID: "proj_ci",
          ZITADEL_PREVIEW_TOKEN: "pk_ci",
        });

        const result = await app.run([
          "origin",
          "add",
          "https://app.acme.com",
          "--kind",
          "primary",
          "--env",
          "ci",
          "--json",
        ]);

        expect(result).toSay("ZITADEL_PROJECT_SECRET");
      });

      it("stores a primary origin on the project", async () => {
        const app = await aSetUpApp();

        const result = await app.addOrigin("https://app.acme.com", "primary");

        expect(result).toSucceed();
        expect(await app.projectOrigins()).toEqual([
          SETUP_ORIGIN,
          { pattern: "https://app.acme.com", kind: "primary" },
        ]);
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("reports the stored pattern, %s", async (_how, colour) => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run(["origin", "add", "https://app.acme.com", "--kind", "primary"], colour),
        );

        expect(result).toPrint("https://app.acme.com");
      });

      it.each(RENDERINGS)(
        "writes a pattern the server wrote a bidi override into as a JSON escape, %s",
        async (_how, colour) => {
          const app = await aSetUpApp();
          platform.storesOrigin("https://app.acme.com\u202eevil");

          const result = await asTerminal(() =>
            app.run(
              ["origin", "add", "https://app.acme.com", "--kind", "primary", "--json"],
              colour,
            ),
          );

          // JSON spells out ESC but writes a bidi override as itself, so printing
          // the envelope would let the server reorder what the reader sees.
          expect(result).toSucceed();
          expect(result.stdout).toContain("\\u202e");
          expect(result.stdout).not.toContain("\u202e");
          // The value is unchanged for anything that parses it back.
          expect(app.envelopeOf<{ pattern: string }>(result).data.pattern).toContain("\u202e");
        },
      );

      it.each(RENDERINGS)(
        "spells out a pattern the server answered with a colour sequence in it, %s",
        async (_how, colour) => {
          const app = await aSetUpApp();
          platform.storesOrigin("https://app.acme.com\u001b[31m");

          const result = await asTerminal(() =>
            app.run(["origin", "add", "https://app.acme.com", "--kind", "primary"], colour),
          );

          // The pattern is the server's text, so it cannot paint the CLI's output:
          // a sequence left intact could colour a refusal to read as success.
          expect(result).toSucceed();
          expect(result.stdout).toContain("\\x1b[31m");
          expect(result.stdout).not.toContain("\u001b[31m");
        },
      );
    });
  });
});
