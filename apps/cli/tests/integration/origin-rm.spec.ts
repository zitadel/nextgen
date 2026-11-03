import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp, SETUP_ORIGIN } from "../helpers/project";

const platform = usePlatformMock();

describe("origin rm", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.removeOrigin("https://app.acme.com");

        expect(result).toFailWith("E_NOT_FOUND");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.removeOrigin("https://app.acme.com");

        expect(result).toFailWith("E_NETWORK");
      });
    });
  });

  describe("against a server that refuses connections", () => {
    it("fails", async () => {
      const app = await aSetUpApp();
      platform.refusesConnections();

      const result = await app.run(["origin", "rm", "https://app.acme.com", "--force", "--json"]);

      expect(result).toFailWith("E_NETWORK");
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses an environment holding only the preview token", async () => {
        const app = await anApp();
        await app.bindEnvironment("ci", {
          ZITADEL_PROJECT_ID: "proj_ci",
          ZITADEL_PREVIEW_TOKEN: "pk_ci",
        });

        const result = await app.run([
          "origin",
          "rm",
          "https://app.acme.com",
          "--force",
          "--env",
          "ci",
          "--json",
        ]);

        expect(result).toSay("ZITADEL_PROJECT_SECRET");
      });

      it("stops admitting a pattern that was added", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");

        const result = await app.removeOrigin("https://app.acme.com");

        expect(result).toSucceed();
        expect(await app.projectOrigins()).toEqual([SETUP_ORIGIN]);
      });

      it("warns that removing the last origin admits every origin", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();
        await app.addOrigin("https://app.acme.com", "primary");

        const result = await app.removeOrigin("https://app.acme.com");

        expect(result).toSay("admits every origin");
      });

      it("says how to add an origin back after removing the last one", async () => {
        const app = await aSetUpApp();
        await app.clearOrigins();
        await app.addOrigin("https://app.acme.com", "primary");

        const result = await app.removeOrigin("https://app.acme.com");

        expect(result).toSay("zitadel origin add <url> --kind primary");
      });

      it("does not warn while other origins remain", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");
        await app.addOrigin("https://www.acme.com", "primary");

        const result = await app.removeOrigin("https://app.acme.com");

        expect(result).not.toSay("admits every origin");
      });

      it("succeeds on a pattern the project does not hold, as the server answers 204", async () => {
        const app = await aSetUpApp();

        const result = await app.removeOrigin("https://app.acme.com");

        expect(result).toSucceed();
      });

      describe("without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await aSetUpApp();
          await app.addOrigin("https://app.acme.com", "primary");

          const result = await app.run(["origin", "rm", "https://app.acme.com", "--json"]);

          expect(result).toFailWith("E_VALIDATION");
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();
          await app.addOrigin("https://app.acme.com", "primary");

          const result = await app.run(["origin", "rm", "https://app.acme.com", "--json"]);

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();
          await app.addOrigin("https://app.acme.com", "primary");

          const result = await app.run(["origin", "rm", "https://app.acme.com", "--json"]);

          expect(result).toSuggestExactly(app.againAsRun("origin rm https://app.acme.com --force"));
        });

        it("removes nothing", async () => {
          const app = await aSetUpApp();
          await app.addOrigin("https://app.acme.com", "primary");

          await app.run(["origin", "rm", "https://app.acme.com", "--json"]);

          expect(await app.projectOrigins()).toEqual([
            SETUP_ORIGIN,
            { pattern: "https://app.acme.com", kind: "primary" },
          ]);
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what stops being admitted", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://app.acme.com", "primary");

        const result = await app.run(["origin", "rm", "https://app.acme.com", "--force"]);

        expect(result).toPrint("https://app.acme.com");
      });
    });
  });
});
