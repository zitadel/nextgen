import { describe, expect, it } from "vitest";

import { useLocalServers } from "../helpers/local-server";
import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();
useLocalServers();

describe("start", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses a port outside the usable range", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "99999", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("Invalid port 99999");
      });

      it("refuses port zero", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toExplain("Invalid port 0");
      });

      it("refuses an image for a runtime that takes none", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "start",
          "--runtime",
          "binary",
          "--image",
          "zitadel:latest",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("--image requires --runtime docker");
      });

      it("brings a directory back on the port it had", async () => {
        const app = await aSetUpApp();
        const first = await app.startLocalServer();
        await app.run(["stop", "--json"]);

        const again = await app.restartLocalServer();

        expect(app.localPortOf(again)).toBe(app.localPortOf(first));
      });

      it("names the server it started as its source, even when it had to move", async () => {
        const app = await aSetUpApp();
        const first = await app.startLocalServer();
        await app.run(["stop", "--json"]);
        const holder = await aSetUpApp();
        await holder.startLocalServer({ port: app.localPortOf(first) });

        const again = await app.restartLocalServer();

        expect(app.envelopeOf(again).source).toBe(`http://localhost:${app.localPortOf(again)}`);
      });

      it("refuses a port another directory's server holds", async () => {
        const owner = await aSetUpApp();
        const held = await owner.startLocalServer();
        const other = await aSetUpApp();

        const result = await other.startLocalServer({ port: owner.localPortOf(held) });

        expect(result).toFailWith("E_PORT_IN_USE");
      });

      it("leaves a running server alone when the port it is asked to move to is held", async () => {
        const owner = await aSetUpApp();
        const held = await owner.startLocalServer();
        const app = await aSetUpApp();
        await app.startLocalServer();

        await app.startLocalServer({ port: owner.localPortOf(held) });

        expect(await app.localServerLifecycle()).toBe("running");
      });

      it("runs one server when two starts race in one directory", async () => {
        const app = await aSetUpApp();

        const [first, second] = await app.startLocalServerTwiceAtOnce();

        expect(app.localPidOf(second!)).toBe(app.localPidOf(first!));
      });

      it("plans a start although the directory's server record cannot be read", async () => {
        const app = await aSetUpApp();
        await app.corruptLocalServerRecord();

        const result = await app.run(["start", "--dry-run", "--json"]);

        expect(result).toSucceed();
      });
    });
  });
});
