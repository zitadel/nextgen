import { describe, expect, it } from "vitest";

import { LOGGED_LINES, useLocalServers } from "../helpers/local-server";
import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();
useLocalServers();

describe("logs", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["logs", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["logs", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["logs", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses when the local runtime has never been started", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["logs", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says the runtime has not been started", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["logs", "--json"]);

        expect(result).toExplain("Local Zitadel runtime has not been started");
      });

      it("shows only the lines at the level asked for, and above", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await app.run(["logs", "--level", "warn", "--json"]);

        expect(app.loggedLinesOf(result)).toEqual([LOGGED_LINES.warning, LOGGED_LINES.error]);
      });

      it("counts only the lines at that level towards the tail", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await app.run(["logs", "--level", "warn", "--tail", "1", "--json"]);

        expect(app.loggedLinesOf(result)).toEqual([LOGGED_LINES.error]);
      });

      it("reads the log of the server an app inside the directory uses", async () => {
        const parent = await aSetUpApp();
        await parent.startLocalServer({ shape: "logging" });
        const app = await parent.appInside("my-app");

        const result = await app.run(["logs", "--json"]);

        expect(app.loggedLinesOf(result)).toEqual(Object.values(LOGGED_LINES));
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the warning", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await app.run(["logs", "--level", "warn"]);

        expect(result).toPrint(LOGGED_LINES.warning);
      });
    });
  });
});
