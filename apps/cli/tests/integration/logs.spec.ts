import { describe, expect, it } from "vitest";

import { LOGGED_LINES, useLocalServers } from "@tests/helpers/local-server";
import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
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

describe("logs", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails because nothing was started", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["logs", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "logs",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "Local Zitadel runtime has not been started",
          hint: "Start the local server first.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });

    describe("that is down", () => {
      it("fails because nothing was started", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["logs", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "logs",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "Local Zitadel runtime has not been started",
          hint: "Start the local server first.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails because nothing was started", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["logs", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "logs",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "Local Zitadel runtime has not been started",
          hint: "Start the local server first.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["logs", "--json"] : ["logs"], how.env),
      );
    });

    describe("--json", () => {
      it("refuses when the local runtime has never been started, and says to start it", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["logs", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: CLI_VERSION,
          command: "logs",
          source: "http://localhost:8080",
          code: "E_VALIDATION",
          message: "Local Zitadel runtime has not been started",
          hint: "Start the local server first.",
          next_commands: [expectedPublicCliCommand(`start --cwd ${app.path}`)],
        });
      });

      it("returns every line the server logged", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer({ shape: "logging" });

        const result = await app.run(["logs", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "logs",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Local Zitadel server logs",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
            },
            logs: `${LOGGED_LINES.info}\n${LOGGED_LINES.warning}\n${LOGGED_LINES.error}\n`,
          },
          warnings: [],
        });
      });

      it("shows only the lines at the level asked for, and above", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer({ shape: "logging" });

        const result = await app.run(["logs", "--level", "warn", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "logs",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Local Zitadel server logs",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
            },
            logs: `${LOGGED_LINES.warning}\n${LOGGED_LINES.error}\n`,
          },
          warnings: [],
        });
      });

      it("counts only the lines at that level towards the tail", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer({ shape: "logging" });

        const result = await app.run(["logs", "--level", "warn", "--tail", "1", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "logs",
          source: `http://localhost:${app.localPortOf(started)}`,
          data: {
            title: "Local Zitadel server logs",
            runtime: {
              backend: "binary",
              pid: app.localPidOf(started),
              log_path: `${app.path}/.zitadel/local/server.log`,
            },
            logs: `${LOGGED_LINES.error}\n`,
          },
          warnings: [],
        });
      });

      it("reads the log of the server an app inside the directory uses", async () => {
        const parent = await aSetUpApp();
        const started = await parent.startLocalServer({ shape: "logging" });
        const app = await parent.appInside("my-app");

        const result = await app.run(["logs", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: CLI_VERSION,
          command: "logs",
          source: `http://localhost:${parent.localPortOf(started)}`,
          data: {
            title: "Local Zitadel server logs",
            runtime: {
              backend: "binary",
              pid: parent.localPidOf(started),
              log_path: `${parent.path}/.zitadel/local/server.log`,
            },
            logs: `${LOGGED_LINES.info}\n${LOGGED_LINES.warning}\n${LOGGED_LINES.error}\n`,
          },
          warnings: [],
        });
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("prints the warning", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await shown(() => app.run(["logs", "--level", "warn"]));

        expect(result).toSayOnce(LOGGED_LINES.warning);
      });

      it("hides the lines below the level asked for", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await shown(() => app.run(["logs", "--level", "warn"]));

        expect(result.stdout).not.toContain("server listening for requests");
      });

      it("spells an escape sequence in a line out, so reading the log cannot drive the terminal", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await shown(() => app.run(["logs", "--level", "error"]));

        expect(result.stdout).toContain("\\x1b]0;pwned\\x07");
        expect(result.stdout).not.toContain("\u001b]0;");
      });

      it("prints a line once", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await shown(() => app.run(["logs", "--level", "error"]));

        expect(result).toSayOnce("request failed");
      });

      it("refuses a directory whose server was never started, on stderr, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["logs"]));

        expect(result.stdout).toBe("");
        expect(result).toSayOnce("Local Zitadel runtime has not been started");
      });

      it("suggests starting the server, once", async () => {
        const app = await aSetUpApp();

        const result = await shown(() => app.run(["logs"]));

        expect(result).toSayOnce(expectedPublicCliCommand(`start --cwd ${app.path}`));
      });
    });

    describe("rendered for a terminal", () => {
      it("titles the lines as --json does", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await asTerminal(() => app.run(["logs"]));

        expect(result).toSayOnce("Local Zitadel server logs");
      });
    });

    describe("rendered piped", () => {
      it("prints the lines and nothing else", async () => {
        const app = await aSetUpApp();
        await app.startLocalServer({ shape: "logging" });

        const result = await offTerminal(() => app.run(["logs", "--level", "warn"]));

        expect(result.stdout).toBe(
          `${LOGGED_LINES.warning}\n${LOGGED_LINES.error.replace("\u001b]0;pwned\u0007", "\\x1b]0;pwned\\x07")}\n`,
        );
      });
    });
  });
});
