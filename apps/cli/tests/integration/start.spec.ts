import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();
useLocalServers();

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

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
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["start", "--port", "0"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("refuses a port outside the usable range", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "99999", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("99999 is not a TCP port");
      });

      it("refuses port zero", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["start", "--port", "0", "--json"]);

        expect(result).toExplain("0 is not a TCP port");
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

      it("suggests no command with a placeholder left in it", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "start",
          "--runtime",
          "binary",
          "--image",
          "zitadel:latest",
          "--json",
        ]);

        expect(result).not.toSuggest("<tag>");
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

      it("suggests the start it planned, with the flags it was given", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "start",
          "--port",
          "9000",
          "--runtime",
          "binary",
          "--dry-run",
          "--json",
        ]);

        expect(result).toSuggest("start --port 9000 --runtime binary");
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("prints where the console is", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.startLocalServer({ json: false }));

        expect(result).toPrint("/ui/console/");
      });

      it("prints the process it started", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.startLocalServer({ json: false }));

        expect(result).toPrint("Process");
      });

      it("prints the port it would use in a dry run", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["start", "--port", "9000", "--dry-run"]));

        expect(result).toPrint("localhost:9000");
      });

      it("prints the image it would use in a dry run", async () => {
        const app = await aSetUpApp();

        const result = await shown(() =>
          app.run([
            "start",
            "--runtime",
            "docker",
            "--image",
            "example.test/zitadel:1",
            "--dry-run",
          ]),
        );

        expect(result).toPrintRow("Image", "example.test/zitadel:1");
      });
    });
  });
});
