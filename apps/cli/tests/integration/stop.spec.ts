import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();
useLocalServers();

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

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
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["stop", "--json"] : ["stop"], how.env),
      );
    });

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

      it("stops a server whose recorded process has died", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "orphaned" });

        await app.run(["stop", "--json"]);

        expect(await app.localServerLifecycle()).toBe("stopped");
      });

      it("can be run twice without complaining", async () => {
        const app = await aSetUpApp();
        expect(await app.run(["stop", "--json"])).toSucceed();

        const result = await app.run(["stop", "--json"]);

        expect(result).toSucceed();
      });

      it("suggests the stop it planned", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["stop", "--dry-run", "--json"]);

        expect(result).toSuggestExactly(`stop --cwd ${app.path}`);
      });

      it("suggests the sweep it planned", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["stop", "--all", "--dry-run", "--json"]);

        expect(result).toSuggestExactly(`stop --all --cwd ${app.path}`);
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("names the process it stopped", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["stop"]));

        expect(result).toPrint(String(app.localPidOf(started)));
      });

      it("names the process it would stop", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["stop", "--dry-run"]));

        expect(result).toPrint(String(app.localPidOf(started)));
      });
    });
  });
});
