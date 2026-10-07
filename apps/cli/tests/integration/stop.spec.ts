import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("stop", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("succeeds when no local runtime is running", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
      });

      it("succeeds in a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
      });

      it("can be run twice without complaining", async () => {
        const app = await aSetUpApp();
        expect(await app.run(["stop", "--json"])).toSucceed();

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
      });
    });
  });
});
