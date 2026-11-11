import { describe, expect, it } from "vitest";

import { useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();
useLocalServers();

const CLI_VERSION = cliVersion.version;

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

describe("console", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails because there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["console", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });

    describe("that is down", () => {
      it("fails because there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["console", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails because there is no local admin to sign in as", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["console", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
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
      it("refuses a project with no local runtime behind it, and says to start one", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["console", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });

      it("refuses a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(["console", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "No local admin in this directory or its parents",
          hint: "Run this from the directory the local server was started in, or one inside it. If it was never started, start it first; that is what creates the local admin the console signs in as.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });

      it("refuses a server that does not host the platform project", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.run(["console", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "console",
          source: `http://localhost:${app.localPortOf(started)}`,
          code: "E_VALIDATION",
          message:
            "The local server does not host the platform project, so the local admin cannot sign in",
          hint: `Stop it with ${expectedPublicCliCommand("stop")}, then run ${expectedPublicCliCommand("start")} so it boots with the platform project and the local admin.`,
          next_commands: [expectedPublicCliCommand("stop"), expectedPublicCliCommand("start")],
          details: { server_url: `http://localhost:${app.localPortOf(started)}` },
        });
      });

      it("plans the sign-in it would mint and suggests the real one", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await app.run(["console", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "console",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Would mint a console sign-in link (dry run)",
            dry_run: true,
            signed_in_as: "admin@zitadel.localhost",
            next_commands: [expectedPublicCliCommand(`console --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });

      it("plans the sign-in from an app inside the directory the server was started in", async () => {
        const parent = await aSetUpApp();
        const started = await parent.startLocalServer();
        const app = await parent.appInside("my-app");

        const result = await app.run(["console", "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "console",
          source: `http://localhost:${parent.localPortOf(started)}`,
          data: {
            title: "Would mint a console sign-in link (dry run)",
            dry_run: true,
            signed_in_as: "admin@zitadel.localhost",
            next_commands: [expectedPublicCliCommand(`console --cwd ${app.path}`)],
          },
          warnings: [],
        });
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("titles a dry run as --json does, ending in (dry run)", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["console", "--dry-run"]));

        expect(result).toSayOnce("Would mint a console sign-in link (dry run)");
      });

      it("names who it would sign in as", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["console", "--dry-run"]));

        expect(result).toPrintRow("Signed in as", "admin@zitadel.localhost");
      });

      it("prints the sign-in it planned, once", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer();

        const result = await shown(() => app.run(["console", "--dry-run"]));

        expect(result).toSayOnce(expectedPublicCliCommand(`console --cwd ${app.path}`));
      });

      it("refuses a project with no local runtime, on stderr, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["console"]));

        expect(result.stdout).toBe("");
        expect(result).toSayOnce("No local admin in this directory or its parents");
      });

      it("suggests starting the server, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["console"]));

        expect(result).toSayOnce(expectedPublicCliCommand(`start --cwd ${app.path}`));
      });
    });
  });
});
