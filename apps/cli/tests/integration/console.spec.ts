import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";

const platform = usePlatformMock();
useLocalServers();

describe("console", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["console", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["console", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["console", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["console", "--json"] : ["console"], how.env),
      );
    });

    describe("--json", () => {
      it("refuses a project with no local runtime behind it", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["console", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["console", "--json"]);

        expect(result).toExplain("No local admin in this directory or its parents");
      });

      it("refuses a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(["console", "--json"]);

        expect(result).toFail();
      });

      it("suggests the sign-in it planned", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await app.run(["console", "--dry-run", "--json"]);

        expect(result).toSuggestExactly(`console --cwd ${app.path}`);
      });
    });

    describe("rendered for a terminal", () => {
      it("says what a dry run would do once", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await app.run(["console", "--dry-run"]);

        expect(result).toSayOnce("Would mint a console sign-in link");
      });
    });
  });
});
